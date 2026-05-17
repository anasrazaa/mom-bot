"""Persist and retrieve live action items detected during a meeting."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from loguru import logger

from app.config import settings
from app.models.schemas import LiveActionItem


class ActionItemManager:
    """File-backed store for a single meeting's live action items."""

    def __init__(self, meeting_id: str):
        self.meeting_id = meeting_id
        self._path: Path = settings.MEETINGS_DIR / f"{meeting_id}_actions.json"
        self._items: List[LiveActionItem] = []
        if self._path.exists():
            self._load()

    # ── Public API ────────────────────────────────────────────────────────────

    def add(
        self,
        speaker: str,
        original_text: str,
        action_text: str,
        detected_at: float,
        assignee: Optional[str] = None,
        deadline: Optional[str] = None,
    ) -> LiveActionItem:
        item = LiveActionItem(
            id=str(uuid.uuid4()),
            meeting_id=self.meeting_id,
            speaker=speaker,
            original_text=original_text,
            action_text=action_text,
            assignee=assignee,
            deadline=deadline,
            detected_at=detected_at,
            completed=False,
            created_at=datetime.now(timezone.utc),
        )
        self._items.append(item)
        self._save()
        return item

    def toggle(self, item_id: str, completed: bool) -> Optional[LiveActionItem]:
        for item in self._items:
            if item.id == item_id:
                item.completed = completed
                self._save()
                return item
        return None

    @property
    def items(self) -> List[LiveActionItem]:
        return list(self._items)

    # ── Internal ─────────────────────────────────────────────────────────────

    def _save(self):
        data = [i.model_dump(mode="json") for i in self._items]
        self._path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")

    def _load(self):
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            self._items = [LiveActionItem(**d) for d in data]
        except Exception as exc:
            logger.warning(f"Could not load action items for {self.meeting_id}: {exc}")
            self._items = []
