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

import numpy as np
from fastapi import WebSocket
from loguru import logger

from app.config import settings
from app.models.schemas import (
    MeetingInfo, MeetingStatus, MoMDocument, TranscriptEntry,
)
from app.modules.diarization import DiarizationModule
from app.modules.export_module import save_docx, save_pdf
from app.modules.llm_processor import LLMProcessor
from app.modules.mom_generator import MoMGenerator
from app.modules.speaker_id import SpeakerIdentificationModule
from app.modules.transcript_manager import TranscriptManager
from app.modules.transcription import TranscriptionModule
from app.modules.vad import VADProcessor


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
    ):
        self.meeting_id = meeting_id
        self.title = title
        self.venue = venue
        self.chaired_by = chaired_by or "Unknown"
        self.start_time = datetime.now(timezone.utc)
        self.end_time: Optional[datetime] = None
        self.status = MeetingStatus.RECORDING
        self.mom: Optional[MoMDocument] = None

        # AI modules (shared across sessions – already loaded)
        self._vad = vad
        self._transcriber = transcriber
        self._diarizer = diarizer
        self._speaker_id = speaker_id

        # Transcript persistence
        self.transcript = TranscriptManager(meeting_id)

        # Audio buffer
        self._buffer: List[np.ndarray] = []
        self._buffer_secs: float = 0.0
        self._lock = asyncio.Lock()

        # Connected WebSocket clients (for live transcript push)
        self.ws_clients: Set[WebSocket] = set()
        # Capture the running loop at creation time so _process() (which runs in
        # a thread-pool) can schedule broadcasts on the correct event loop.
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

        # Run in thread-pool so we don't block the event loop
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

                # STT
                text = self._transcriber.transcribe_segment(seg_audio, sample_rate)
                if not text:
                    continue

                # Speaker name (optional)
                if self._speaker_id is not None:
                    speaker_name = self._speaker_id.identify(
                        seg_audio, sample_rate, fallback=spk_label
                    )
                else:
                    speaker_name = spk_label

                entry = self.transcript.add_entry(
                    speaker=speaker_name,
                    text=text,
                    start_time=offset + seg_start,
                    end_time=offset + seg_end,
                )
                entries.append(entry)

            # 4. Broadcast to WS clients (schedule on event loop)
            if entries:
                for entry in entries:
                    asyncio.run_coroutine_threadsafe(self._broadcast(entry), self._loop)

        except Exception as exc:
            logger.error(f"[{self.meeting_id}] Pipeline error: {exc}", exc_info=True)

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

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def update_info(self, venue: Optional[str] = None, chaired_by: Optional[str] = None):
        if venue is not None:
            self.venue = venue
        if chaired_by is not None:
            self.chaired_by = chaired_by

    async def stop(self):
        """Flush remaining audio and save transcript."""
        self.status = MeetingStatus.STOPPED
        self.end_time = datetime.now(timezone.utc)

        if self._buffer:
            combined = np.concatenate(self._buffer)
            self._buffer = []
            await asyncio.to_thread(self._process, combined, settings.SAMPLE_RATE)

        self.transcript.save()
        self._save_session_meta()
        logger.info(f"Meeting {self.meeting_id} stopped  |  {len(self.transcript.entries)} entries")

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
        """Load all AI models (called once at startup).

        VAD and Whisper are hard requirements — crash if they fail.
        Diarization and Speaker ID degrade gracefully if unavailable.
        """
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
        self, title: str, venue: str, chaired_by: Optional[str] = None
    ) -> str:
        self._require_models()
        # Enforce one live meeting at a time
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
        )
        self._sessions[meeting_id] = session
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

    async def stop_meeting(self, meeting_id: str):
        session = self._get_or_raise(meeting_id)
        await session.stop()

    async def generate_mom(
        self,
        meeting_id: str,
        additional_context: Optional[str] = None,
    ) -> MoMDocument:
        session = self._get_or_raise(meeting_id)

        if session.status == MeetingStatus.RECORDING:
            raise ValueError("Stop the meeting before generating MoM")

        session.status = MeetingStatus.PROCESSING

        transcript_text = session.transcript.get_speaker_turns()
        if not transcript_text.strip():
            session.status = MeetingStatus.STOPPED
            raise ValueError("Transcript is empty – nothing to summarise")

        llm_data = await self._llm.generate_mom(
            transcript=transcript_text,
            meeting_date=session.start_time.strftime("%d %B %Y"),
            meeting_time=session.start_time.strftime("%I:%M %p"),
            venue=session.venue,
            additional_context=additional_context,
        )

        mom = self._mom_gen.build(
            meeting_id=meeting_id,
            llm_data=llm_data,
            fallback_venue=session.venue,
        )
        session.mom = mom
        session.status = MeetingStatus.COMPLETED

        # Persist MoM JSON alongside transcript
        mom_path = settings.MEETINGS_DIR / f"{meeting_id}_mom.json"
        mom_path.write_text(
            mom.model_dump_json(indent=2), encoding="utf-8"
        )
        logger.info(f"MoM generated and saved: {mom_path}")
        return mom

    async def export_docx(self, meeting_id: str) -> Path:
        mom = self._get_mom(meeting_id)
        return await asyncio.to_thread(save_docx, mom)

    async def export_pdf(self, meeting_id: str) -> Path:
        mom = self._get_mom(meeting_id)
        return await asyncio.to_thread(save_pdf, mom)

    def list_meetings(self) -> List[MeetingInfo]:
        # Active sessions
        infos = [s.get_info() for s in self._sessions.values()]

        # Completed sessions from disk (not in memory)
        seen = {s.meeting_id for s in self._sessions.values()}
        for meta_file in sorted(settings.MEETINGS_DIR.glob("*_meta.json")):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
                if data["meeting_id"] not in seen:
                    infos.append(MeetingInfo(**data))
            except Exception:
                pass

        return infos

    # ── Speaker enrollment (delegates to speaker_id module) ──────────────────

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
        session = self._get_or_raise(meeting_id)
        if not session.mom:
            raise ValueError("MoM not generated yet – call /generate_mom first")
        return session.mom


# ─────────────────────────────────────────────────────────────────────────────
# Global singleton (imported by routes)
# ─────────────────────────────────────────────────────────────────────────────
pipeline_manager = PipelineManager()
