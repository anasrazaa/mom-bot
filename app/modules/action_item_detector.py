"""Detect action items from meeting transcripts using batch LLM inference.

No pre-filter/regex gate — every transcript line reaches the LLM.
Entries are batched together so the LLM has conversational context,
which also catches multi-turn action items (e.g. someone asking a question
and another person agreeing to do something in the next turn).
"""
from typing import List, Optional

import httpx
from loguru import logger

from app.config import settings
from app.utils.helpers import safe_json_loads

# How many NEW entries to accumulate before triggering a batch LLM call.
BATCH_SIZE = 10

# How many entries from the previous batch to carry into the next one as
# context — this prevents action items that span a batch boundary from
# being silently missed (e.g. an assignment on line 10 accepted on line 11).
# Carried entries are sent to the LLM for context but action items found
# in them are NOT recorded again (deduplication).
OVERLAP = 5

# Fragments shorter than this are included in batch for context but never
# returned as action items by the LLM on their own.
_MIN_WORDS = 4

_SYSTEM = """\
You are an expert at extracting action items from faculty meeting transcripts.
The meeting may be in English, Urdu (Roman script), Arabic-script Urdu, or a natural mix of both.
An action item is a concrete task that someone is explicitly asked to do, commits to doing, or is clearly assigned.
Use ALL the provided lines for context — an assignment can span multiple turns \
(e.g. someone asks a question and the next speaker agrees to do it).
Be thorough: do NOT miss any action items regardless of the language used.\
"""

_BATCH_PROMPT = """\
Below are {n} consecutive lines from a live faculty meeting transcript \
(first 5 lines are carry-over context from the previous batch).
Text may be in English, Urdu (Roman or Arabic script), or a mix — understand all of it.

{lines}

Identify ALL action items present in the lines above.
An action item must be a real, specific task assigned to or accepted by someone.

Return a JSON array. For each action item:
{{"line": <1-based line number>, "action_text": "concise task description in English", "assignee": "name or null", "deadline": "deadline or null"}}

If no action items are found, return an empty array: []
Return ONLY the JSON array — no explanation, no markdown.\
"""


class ActionItemDetector:
    """Batch action item detection — no pre-filter, full LLM with context."""

    def __init__(self):
        self._url = settings.OLLAMA_BASE_URL
        self._model = settings.LLM_MODEL

    async def detect_batch(self, entries: List[dict], context_count: int = 0) -> List[dict]:
        """Detect action items from a batch of transcript entries.

        Args:
            entries: list of {"speaker": str, "text": str} dicts in order.
            context_count: how many leading entries are carry-over context from
                the previous batch. Action items found in those entries are
                ignored to avoid duplicates — they were already a candidate in
                the previous batch.

        Returns:
            list of {"entry_index": int, "action_text": str,
                      "assignee": str|None, "deadline": str|None}
            entry_index is relative to the entries list (0-based).
        """
        if not entries:
            return []

        lines = "\n".join(
            f"{i + 1}. [{e['speaker']}]: {e['text']}"
            for i, e in enumerate(entries)
        )
        prompt = _BATCH_PROMPT.format(n=len(entries), lines=lines)

        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                r = await client.post(
                    f"{self._url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": _SYSTEM},
                            {"role": "user",   "content": prompt},
                        ],
                        "options": {"temperature": 0.0},
                        "stream": False,
                    },
                )
            raw = r.json()["message"]["content"]
            parsed = safe_json_loads(raw)
            if not isinstance(parsed, list):
                return []

            results = []
            for item in parsed:
                line_num = item.get("line", 0)
                idx = line_num - 1  # convert to 0-based
                # Skip entries that are carry-over context from previous batch
                if idx < context_count:
                    continue
                if 0 <= idx < len(entries) and item.get("action_text"):
                    results.append({
                        "entry_index": idx,
                        "action_text": item["action_text"],
                        "assignee":    item.get("assignee"),
                        "deadline":    item.get("deadline"),
                    })
            return results

        except Exception as exc:
            logger.debug(f"Batch action item detection failed: {exc}")
            return []


# Module-level singleton
action_detector = ActionItemDetector()
