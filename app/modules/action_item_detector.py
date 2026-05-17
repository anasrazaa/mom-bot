"""Detect action items in transcript text using regex pre-filter + LLM."""
import re
from typing import Optional

import httpx
from loguru import logger

from app.config import settings
from app.utils.helpers import safe_json_loads

# Regex pre-filter — only send to LLM when these patterns appear
_ACTION_RE = re.compile(
    r"\b(will|shall|should|must|needs? to|going to|has to|have to|"
    r"please|action|follow.?up|assigned|responsible|task|"
    r"submit|prepare|review|send|share|complete|finish|update|report|"
    r"coordinate|arrange|schedule|organise|organize|ensure|"
    r"by (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|"
    r"next week|end of|tomorrow|today|jan|feb|mar|apr|may|jun|"
    r"jul|aug|sep|oct|nov|dec|\d+))\b",
    re.IGNORECASE,
)

_SYSTEM = (
    "You extract action items from meeting transcript lines. "
    "An action item is a concrete task someone is asked or agrees to do."
)

_PROMPT = """\
Transcript line — Speaker: {speaker}
Text: "{text}"

If this contains an action item return JSON:
{{"is_action": true, "action_text": "short task description", "assignee": "person name or null", "deadline": "deadline or null"}}

If not an action item return:
{{"is_action": false}}

Return ONLY valid JSON."""


class ActionItemDetector:
    """Two-phase action item detection: regex gate → LLM confirmation."""

    def __init__(self):
        self._url = settings.OLLAMA_BASE_URL
        self._model = settings.LLM_MODEL

    def is_candidate(self, text: str) -> bool:
        return bool(_ACTION_RE.search(text))

    async def detect(self, text: str, speaker: str) -> Optional[dict]:
        """Return a dict with action item fields, or None if not an action item."""
        if not self.is_candidate(text):
            return None
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                r = await client.post(
                    f"{self._url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": _SYSTEM},
                            {"role": "user",   "content": _PROMPT.format(
                                speaker=speaker, text=text
                            )},
                        ],
                        "options": {"temperature": 0.0},
                        "stream": False,
                    },
                )
            raw = r.json()["message"]["content"]
            parsed = safe_json_loads(raw)
            if parsed and parsed.get("is_action"):
                return {
                    "action_text": parsed.get("action_text", text),
                    "assignee":    parsed.get("assignee"),
                    "deadline":    parsed.get("deadline"),
                }
        except Exception as exc:
            logger.debug(f"Action item detection skipped: {exc}")
        return None


# Module-level singleton
action_detector = ActionItemDetector()
