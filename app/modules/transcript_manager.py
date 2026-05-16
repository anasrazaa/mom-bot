"""Transcript storage and retrieval.

Manages structured JSON transcript entries per meeting.
"""
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from loguru import logger
from app.config import settings
from app.models.schemas import TranscriptEntry


class TranscriptManager:
    """Persist and manage transcript entries for one meeting."""

    def __init__(self, meeting_id: str):
        self.meeting_id = meeting_id
        self._entries: List[TranscriptEntry] = []
        self._path: Path = settings.MEETINGS_DIR / f"{meeting_id}_transcript.json"

        # Load existing if resuming
        if self._path.exists():
            self._load()

    # ── Public API ────────────────────────────────────────────────────────────

    def add_entry(
        self,
        speaker: str,
        text: str,
        start_time: float,
        end_time: float,
        language: Optional[str] = None,
    ) -> TranscriptEntry:
        entry = TranscriptEntry(
            id=str(uuid.uuid4()),
            speaker=speaker,
            text=text,
            start_time=round(start_time, 2),
            end_time=round(end_time, 2),
            timestamp=datetime.now(),
            language=language,
        )
        self._entries.append(entry)
        return entry

    @property
    def entries(self) -> List[TranscriptEntry]:
        return list(self._entries)

    def get_full_text(self) -> str:
        """Return concatenated transcript suitable for LLM input."""
        lines = []
        for e in self._entries:
            lines.append(f"{e.speaker}: {e.text}")
        return "\n".join(lines)

    def get_speaker_turns(self) -> str:
        """Same as get_full_text but with timestamps."""
        lines = []
        for e in self._entries:
            ts = f"[{self._fmt(e.start_time)}]"
            lines.append(f"{ts} {e.speaker}: {e.text}")
        return "\n".join(lines)

    def save(self):
        data = [e.model_dump(mode="json") for e in self._entries]
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        logger.debug(f"Transcript saved: {self._path}")

    def clear(self):
        self._entries = []

    # ── Internal ─────────────────────────────────────────────────────────────

    def _load(self):
        with open(self._path, encoding="utf-8") as f:
            raw = json.load(f)
        self._entries = [TranscriptEntry(**e) for e in raw]
        logger.debug(f"Loaded {len(self._entries)} transcript entries from {self._path}")

    @staticmethod
    def _fmt(seconds: float) -> str:
        m, s = divmod(int(seconds), 60)
        return f"{m:02d}:{s:02d}"
