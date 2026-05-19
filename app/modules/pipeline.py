"""Central pipeline orchestrator.

Manages meeting sessions end-to-end:
  audio chunks → VAD → Diarization → STT → Speaker ID → Transcript
  transcript → LLM → MoM document
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set
from zoneinfo import ZoneInfo

import numpy as np
from fastapi import WebSocket
from loguru import logger

from app.config import settings
from app.models.schemas import (
    MeetingInfo, MeetingStatus, MoMDocument, TranscriptEntry,
)
from app.modules.action_item_detector import action_detector
from app.modules.action_item_manager import ActionItemManager
from app.modules.diarization import DiarizationModule
from app.modules.export_module import save_docx, save_pdf
from app.modules.llm_processor import LLMProcessor
from app.modules.mom_generator import MoMGenerator
from app.modules.rag import rag_module
from app.modules.speaker_id import SpeakerIdentificationModule, SpeakerTracker
from app.modules.transcript_manager import TranscriptManager
from app.modules.transcription import TranscriptionModule
from app.modules.vad import VADProcessor


# ── Timezone helper ──────────────────────────────────────────────────────────

def _local_dt(utc_dt: datetime) -> datetime:
    """Convert a UTC datetime to the configured local timezone, falling back to system local."""
    try:
        tz = ZoneInfo(settings.TIMEZONE)
    except Exception:
        # Misconfigured timezone key — fall back to system local timezone
        tz = datetime.now().astimezone().tzinfo
    return utc_dt.astimezone(tz)


# ─────────────────────────────────────────────────────────────────────────────
# Single meeting session
# ─────────────────────────────────────────────────────────────────────────────

class MeetingSession:
    """Manages the audio→transcript pipeline for one meeting."""

    def __init__(
        self,
        meeting_id: str,
        title: str,
        venue: str,
        chaired_by: Optional[str],
        vad: VADProcessor,
        transcriber: TranscriptionModule,
        diarizer: DiarizationModule,
        speaker_id: SpeakerIdentificationModule,
        agenda: Optional[List[str]] = None,
    ):
        self.meeting_id = meeting_id
        self.title = title
        self.venue = venue
        self.chaired_by = chaired_by or "Unknown"
        self.agenda: List[str] = agenda or []
        self.start_time = datetime.now(timezone.utc)
        self.end_time: Optional[datetime] = None
        self.status = MeetingStatus.RECORDING
        self.mom: Optional[MoMDocument] = None

        # AI modules (shared across sessions – already loaded)
        self._vad = vad
        self._transcriber = transcriber
        self._diarizer = diarizer
        self._speaker_id = speaker_id

        # Transcript + action item persistence
        self.transcript = TranscriptManager(meeting_id)
        self.action_items = ActionItemManager(meeting_id)

        # Per-meeting speaker tracker for temporal consistency
        self._speaker_tracker = SpeakerTracker()

        # Live summary cache (refreshed periodically by the chat route)
        self.live_summary: Optional[dict] = None
        self._summary_tx_count: int = 0  # transcript count at last summary

        # Audio buffer
        self._buffer: List[np.ndarray] = []
        self._buffer_secs: float = 0.0
        self._lock = asyncio.Lock()

        # Action item sliding-window buffer.
        # _action_pending: new entries since the last batch was sent.
        # _action_carry:   last OVERLAP entries from the previous batch —
        #                  prepended to the next batch for cross-boundary context.
        from app.modules.action_item_detector import BATCH_SIZE as _AID_BATCH, OVERLAP as _AID_OVERLAP
        self._action_pending: List[TranscriptEntry] = []
        self._action_carry: List[TranscriptEntry] = []
        self._action_batch_size: int = _AID_BATCH
        self._action_overlap: int = _AID_OVERLAP

        # Connected WebSocket clients (live transcript + action item push)
        self.ws_clients: Set[WebSocket] = set()
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = asyncio.new_event_loop()

    # ── Audio ingestion ───────────────────────────────────────────────────────

    async def ingest(self, audio: np.ndarray, sample_rate: int = 16000):
        """Accept an audio chunk. Triggers processing when buffer fills."""
        if self.status != MeetingStatus.RECORDING:
            return

        self._buffer.append(audio)
        self._buffer_secs += len(audio) / sample_rate

        if self._buffer_secs >= settings.CHUNK_DURATION:
            await self._flush(sample_rate)

    async def _flush(self, sample_rate: int):
        async with self._lock:
            if not self._buffer:
                return
            combined = np.concatenate(self._buffer)
            self._buffer = []
            self._buffer_secs = 0.0

        asyncio.create_task(
            asyncio.to_thread(self._process, combined, sample_rate)
        )

    # ── Pipeline ──────────────────────────────────────────────────────────────

    def _process(self, audio: np.ndarray, sample_rate: int):
        """VAD → Diarization → STT → Speaker ID → store → push."""
        try:
            # 1. VAD – skip silent chunks
            if not self._vad.has_speech(audio, sample_rate):
                return

            # 2. Diarization (optional — falls back to single speaker)
            if self._diarizer is not None:
                raw_segments = self._diarizer.diarize(audio, sample_rate)
                segments = DiarizationModule.merge_short_segments(raw_segments)
            else:
                segments = []

            if not segments:
                segments = [(0.0, len(audio) / sample_rate, "SPEAKER_00")]

            # 3. STT + Speaker ID per segment
            offset = (datetime.now(timezone.utc) - self.start_time).total_seconds() - (
                len(audio) / sample_rate
            )

            entries: List[TranscriptEntry] = []
            for seg_start, seg_end, spk_label in segments:
                s = int(seg_start * sample_rate)
                e = int(seg_end * sample_rate)
                seg_audio = audio[s:e]

                if len(seg_audio) < sample_rate * 0.2:
                    continue

                text, confidence, detected_lang = self._transcriber.transcribe_segment_meta(seg_audio, sample_rate)
                if not text:
                    continue

                if self._speaker_id is not None:
                    speaker_name = self._speaker_id.identify(
                        seg_audio, sample_rate,
                        fallback=spk_label,
                        tracker=self._speaker_tracker,
                    )
                else:
                    speaker_name = spk_label

                entry = self.transcript.add_entry(
                    speaker=speaker_name,
                    text=text,
                    start_time=offset + seg_start,
                    end_time=offset + seg_end,
                    language=detected_lang,
                    confidence=confidence,
                )
                entries.append(entry)

            # 4. Broadcast transcript + schedule action item detection
            if entries:
                for entry in entries:
                    asyncio.run_coroutine_threadsafe(self._broadcast(entry), self._loop)
                    asyncio.run_coroutine_threadsafe(
                        self._check_action_item(entry), self._loop
                    )

        except Exception as exc:
            logger.error(f"[{self.meeting_id}] Pipeline error: {exc}", exc_info=True)

    async def _check_action_item(self, entry: TranscriptEntry):
        """Buffer entries; when BATCH_SIZE new entries accumulate, send
        carry (context) + pending (new) to the LLM together.  The carry
        gives cross-boundary context so action items that span two batches
        are never missed."""
        self._action_pending.append(entry)
        if len(self._action_pending) >= self._action_batch_size:
            await self._flush_action_batch()

    async def _flush_action_batch(self):
        """Send current carry + pending to LLM, then rotate the window."""
        if not self._action_pending:
            return
        batch = list(self._action_carry) + list(self._action_pending)
        context_count = len(self._action_carry)
        # New carry = last OVERLAP entries of the batch we're about to process
        self._action_carry = self._action_pending[-self._action_overlap:]
        self._action_pending = []
        await self._process_action_batch(batch, context_count=context_count)

    async def _process_action_batch(self, entries: List[TranscriptEntry], context_count: int = 0):
        """Send a batch of entries to the LLM and broadcast any action items found."""
        entry_dicts = [{"speaker": e.speaker, "text": e.text} for e in entries]
        results = await action_detector.detect_batch(entry_dicts, context_count=context_count)
        for r in results:
            idx = r["entry_index"]
            if 0 <= idx < len(entries):
                src = entries[idx]
                item = self.action_items.add(
                    speaker=src.speaker,
                    original_text=src.text,
                    action_text=r["action_text"],
                    detected_at=src.start_time,
                    assignee=r.get("assignee"),
                    deadline=r.get("deadline"),
                )
                await self._broadcast_action_item(item)

    async def _broadcast(self, entry: TranscriptEntry):
        dead: Set[WebSocket] = set()
        for ws in self.ws_clients:
            try:
                await ws.send_json(
                    {"type": "transcript", "data": entry.model_dump(mode="json")}
                )
            except Exception:
                dead.add(ws)
        self.ws_clients -= dead

    async def _broadcast_action_item(self, item):
        dead: Set[WebSocket] = set()
        for ws in self.ws_clients:
            try:
                await ws.send_json(
                    {"type": "action_item", "data": item.model_dump(mode="json")}
                )
            except Exception:
                dead.add(ws)
        self.ws_clients -= dead

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def update_info(self, venue: Optional[str] = None, chaired_by: Optional[str] = None):
        if venue is not None:
            self.venue = venue
        if chaired_by is not None:
            self.chaired_by = chaired_by

    def set_agenda(self, agenda: List[str]):
        self.agenda = [a.strip() for a in agenda if a.strip()]
        self._save_session_meta()

    async def stop(self):
        """Flush remaining audio and save transcript."""
        self.status = MeetingStatus.STOPPED
        self.end_time = datetime.now(timezone.utc)
        self._speaker_tracker.reset()

        if self._buffer:
            combined = np.concatenate(self._buffer)
            self._buffer = []
            await asyncio.to_thread(self._process, combined, settings.SAMPLE_RATE)

        # Flush any remaining entries that didn't fill a full batch
        if self._action_pending:
            await self._flush_action_batch()

        self.transcript.save()
        self._save_session_meta()
        logger.info(f"Meeting {self.meeting_id} stopped  |  {len(self.transcript.entries)} entries")

        # Index transcript into RAG after stopping
        asyncio.create_task(
            asyncio.to_thread(
                rag_module.index_meeting,
                self.meeting_id,
                self.title,
                self.transcript.get_speaker_turns(),
            )
        )

    def _save_session_meta(self):
        meta = {
            "meeting_id": self.meeting_id,
            "title": self.title,
            "venue": self.venue,
            "chaired_by": self.chaired_by,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "status": self.status.value,
            "transcript_count": len(self.transcript.entries),
            "agenda": self.agenda,
        }
        path = settings.MEETINGS_DIR / f"{self.meeting_id}_meta.json"
        path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def get_info(self) -> MeetingInfo:
        return MeetingInfo(
            meeting_id=self.meeting_id,
            title=self.title,
            venue=self.venue,
            chaired_by=self.chaired_by,
            start_time=self.start_time,
            end_time=self.end_time,
            status=self.status,
            transcript_count=len(self.transcript.entries),
            agenda=self.agenda or None,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Global manager
# ─────────────────────────────────────────────────────────────────────────────

class PipelineManager:
    """Singleton: loads all models once, manages all meeting sessions."""

    def __init__(self):
        self._sessions: Dict[str, MeetingSession] = {}
        self._vad: Optional[VADProcessor] = None
        self._transcriber: Optional[TranscriptionModule] = None
        self._diarizer: Optional[DiarizationModule] = None
        self._speaker_id: Optional[SpeakerIdentificationModule] = None
        self._llm = LLMProcessor()
        self._mom_gen = MoMGenerator()
        self.models_loaded = False

    async def load_models(self):
        logger.info("=== Loading AI models ===")

        self._vad = VADProcessor()
        await asyncio.to_thread(self._vad.load)
        logger.info("✓ VAD loaded")

        self._transcriber = TranscriptionModule()
        await asyncio.to_thread(self._transcriber.load)
        logger.info("✓ Whisper STT loaded")

        self._diarizer = DiarizationModule()
        try:
            await asyncio.to_thread(self._diarizer.load)
            logger.info("✓ Pyannote diarization loaded")
        except Exception as exc:
            logger.warning(
                f"⚠ Pyannote diarization failed to load: {exc}\n"
                "  Diarization disabled — transcripts will use single-speaker fallback.\n"
                "  Fix: accept model licences at https://hf.co/pyannote/speaker-diarization-3.1 "
                "and https://hf.co/pyannote/segmentation-3.0, then restart."
            )
            self._diarizer = None

        self._speaker_id = SpeakerIdentificationModule()
        try:
            await asyncio.to_thread(self._speaker_id.load)
            logger.info("✓ Speaker ID loaded")
        except Exception as exc:
            logger.warning(f"⚠ Speaker ID failed to load: {exc}  —  speaker names will use generic labels.")
            self._speaker_id = None

        self.models_loaded = True
        logger.info("=== Core models ready (STT + VAD) ===")

    # ── Meeting lifecycle ─────────────────────────────────────────────────────

    def create_meeting(
        self,
        title: str,
        venue: str,
        chaired_by: Optional[str] = None,
        agenda: Optional[List[str]] = None,
    ) -> str:
        self._require_models()
        for session in self._sessions.values():
            if session.status == MeetingStatus.RECORDING:
                raise RuntimeError(
                    f"Meeting '{session.title}' is already recording. Stop it before starting a new one."
                )
        meeting_id = str(uuid.uuid4())
        session = MeetingSession(
            meeting_id=meeting_id,
            title=title,
            venue=venue,
            chaired_by=chaired_by,
            vad=self._vad,
            transcriber=self._transcriber,
            diarizer=self._diarizer,
            speaker_id=self._speaker_id,
            agenda=agenda,
        )
        self._sessions[meeting_id] = session
        session._save_session_meta()
        logger.info(f"Meeting created: {meeting_id}  title='{title}'")
        return meeting_id

    def get_session(self, meeting_id: str) -> Optional[MeetingSession]:
        return self._sessions.get(meeting_id)

    def update_meeting(self, meeting_id: str, venue: Optional[str], chaired_by: Optional[str]):
        session = self._get_or_raise(meeting_id)
        if session.status != MeetingStatus.RECORDING:
            raise ValueError("Can only edit a meeting while it is recording")
        session.update_info(venue=venue, chaired_by=chaired_by)
        return session.get_info()

    def update_agenda(self, meeting_id: str, agenda: List[str]) -> MeetingInfo:
        session = self._get_or_raise(meeting_id)
        session.set_agenda(agenda)
        return session.get_info()

    async def stop_meeting(self, meeting_id: str):
        session = self._get_or_raise(meeting_id)
        await session.stop()

    async def generate_mom(
        self,
        meeting_id: str,
        additional_context: Optional[str] = None,
        draft_points: Optional[dict] = None,
    ) -> MoMDocument:
        session = self._sessions.get(meeting_id)

        if session:
            if session.status == MeetingStatus.RECORDING:
                raise ValueError("Stop the meeting before generating MoM")
            session.status = MeetingStatus.PROCESSING
            transcript_text = session.transcript.get_speaker_turns()
            if not transcript_text.strip():
                session.status = MeetingStatus.STOPPED
                raise ValueError("Transcript is empty – nothing to summarise")
            meeting_date = _local_dt(session.start_time).strftime("%d %B %Y")
            meeting_time = _local_dt(session.start_time).strftime("%I:%M %p")
            venue  = session.venue
            agenda = session.agenda or None
        else:
            # Historical meeting — load from disk
            meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
            if not meta_path.exists():
                raise KeyError(f"Meeting {meeting_id} not found")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            tm = TranscriptManager(meeting_id)
            transcript_text = tm.get_speaker_turns()
            if not transcript_text.strip():
                raise ValueError("Transcript is empty – nothing to summarise")
            start_dt = datetime.fromisoformat(meta.get("start_time", ""))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            local_start = _local_dt(start_dt)
            meeting_date = local_start.strftime("%d %B %Y")
            meeting_time = local_start.strftime("%I:%M %p")
            venue  = meta.get("venue", "")
            agenda = meta.get("agenda") or None

        if draft_points:
            llm_data = await self._llm.generate_mom_from_draft_points(
                transcript=transcript_text,
                draft_points=draft_points,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                venue=venue,
                additional_context=additional_context,
            )
        else:
            llm_data = await self._llm.generate_mom(
                transcript=transcript_text,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                venue=venue,
                agenda=agenda,
                additional_context=additional_context,
            )

        mom = self._mom_gen.build(
            meeting_id=meeting_id,
            llm_data=llm_data,
            fallback_venue=venue,
        )

        if session:
            session.mom = mom
            session.status = MeetingStatus.COMPLETED
            session._save_session_meta()

        mom_path = settings.MEETINGS_DIR / f"{meeting_id}_mom.json"
        mom_path.write_text(mom.model_dump_json(indent=2), encoding="utf-8")
        logger.info(f"MoM generated and saved: {mom_path}")

        # Persist completed status for historical meetings (no active session)
        if not session:
            meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["status"] = MeetingStatus.COMPLETED.value
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        return mom

    async def generate_mom_draft_points(
        self,
        meeting_id: str,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Generate editable draft points before final MoM generation."""
        session = self._sessions.get(meeting_id)

        if session:
            if session.status == MeetingStatus.RECORDING:
                raise ValueError("Stop the meeting before preparing MoM draft points")
            transcript_text = session.transcript.get_speaker_turns()
            if not transcript_text.strip():
                raise ValueError("Transcript is empty – nothing to summarise")
            meeting_date = _local_dt(session.start_time).strftime("%d %B %Y")
            meeting_time = _local_dt(session.start_time).strftime("%I:%M %p")
            venue = session.venue
            agenda = session.agenda or None
        else:
            meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
            if not meta_path.exists():
                raise KeyError(f"Meeting {meeting_id} not found")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            tm = TranscriptManager(meeting_id)
            transcript_text = tm.get_speaker_turns()
            if not transcript_text.strip():
                raise ValueError("Transcript is empty – nothing to summarise")
            start_dt = datetime.fromisoformat(meta.get("start_time", ""))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            local_start = _local_dt(start_dt)
            meeting_date = local_start.strftime("%d %B %Y")
            meeting_time = local_start.strftime("%I:%M %p")
            venue = meta.get("venue", "")
            agenda = meta.get("agenda") or None

        return await self._llm.generate_mom_draft_points(
            transcript=transcript_text,
            meeting_date=meeting_date,
            meeting_time=meeting_time,
            venue=venue,
            agenda=agenda,
            additional_context=additional_context,
        )

    async def generate_live_summary(self, meeting_id: str) -> dict:
        """Generate or return cached live meeting summary."""
        session = self._sessions.get(meeting_id)
        if session:
            tx_count = len(session.transcript.entries)
            if (
                session.live_summary is not None
                and tx_count - session._summary_tx_count < 10
            ):
                return session.live_summary
            tx_text = session.transcript.get_speaker_turns()
        else:
            meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
            if not meta_path.exists():
                raise KeyError(f"Meeting {meeting_id} not found")
            tm = TranscriptManager(meeting_id)
            tx_text = tm.get_speaker_turns()

        summary = await self._llm.generate_summary(tx_text)

        if session:
            session.live_summary = summary
            session._summary_tx_count = len(session.transcript.entries)

        return summary

    async def export_docx(self, meeting_id: str) -> Path:
        mom = self._get_mom(meeting_id)
        return await asyncio.to_thread(save_docx, mom)

    async def export_pdf(self, meeting_id: str) -> Path:
        mom = self._get_mom(meeting_id)
        return await asyncio.to_thread(save_pdf, mom)

    def list_meetings(self) -> List[MeetingInfo]:
        infos = [s.get_info() for s in self._sessions.values()]
        seen = {s.meeting_id for s in self._sessions.values()}
        for meta_file in sorted(settings.MEETINGS_DIR.glob("*_meta.json")):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
                if data["meeting_id"] not in seen:
                    infos.append(MeetingInfo(**data))
            except Exception:
                pass
        return infos

    # ── Speaker enrollment ────────────────────────────────────────────────────

    @property
    def speaker_id_module(self) -> SpeakerIdentificationModule:
        self._require_models()
        if self._speaker_id is None:
            raise RuntimeError("Speaker ID model is not loaded — check server logs for the reason.")
        return self._speaker_id

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _require_models(self):
        if not self.models_loaded:
            raise RuntimeError("Models not loaded yet – server is still initialising")

    def _get_or_raise(self, meeting_id: str) -> MeetingSession:
        session = self._sessions.get(meeting_id)
        if not session:
            raise KeyError(f"Meeting {meeting_id} not found")
        return session

    def _get_mom(self, meeting_id: str) -> MoMDocument:
        session = self._sessions.get(meeting_id)
        if session and session.mom:
            return session.mom
        mom_path = settings.MEETINGS_DIR / f"{meeting_id}_mom.json"
        if mom_path.exists():
            return MoMDocument(**json.loads(mom_path.read_text(encoding="utf-8")))
        if not session:
            raise KeyError(f"Meeting {meeting_id} not found")
        raise ValueError("MoM not generated yet – call /generate_mom first")


# ─────────────────────────────────────────────────────────────────────────────
# Global singleton (imported by routes)
# ─────────────────────────────────────────────────────────────────────────────
pipeline_manager = PipelineManager()
