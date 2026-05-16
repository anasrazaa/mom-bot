"""LLM processing via Ollama.

Sends meeting transcripts to a local Qwen2.5 / Llama3 model
and returns structured MoM data as JSON.
"""
import json
import httpx
from datetime import datetime
from typing import Optional
from loguru import logger
from app.config import settings
from app.utils.helpers import safe_json_loads


# ─────────────────────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a professional academic secretary at Ghulam Ishaq Khan (GIK) Institute \
of Engineering Sciences and Technology. You specialise in writing formal Minutes \
of Meeting (MoM) for faculty and senate meetings.

STRICT RULES:
1. Use ONLY information explicitly stated in the transcript — never fabricate, \
   infer, or hallucinate content.
2. Write in formal, academic English. If the transcript contains Urdu or Roman \
   Urdu, translate the relevant portions accurately.
3. If a field cannot be determined from the transcript, set it to "Not mentioned".
4. Action items must include who is responsible and the stated deadline (or "TBD").
5. Separate decisions from discussions clearly.
6. Return ONLY valid JSON — no markdown fences, no additional prose.\
"""

USER_PROMPT_TEMPLATE = """\
Analyse the meeting transcript below and produce a structured Minutes of Meeting.

MEETING DATE  : {date}
MEETING TIME  : {time}
VENUE         : {venue}
ADDITIONAL CTX: {context}

TRANSCRIPT:
-----------
{transcript}
-----------

Return the MoM as a single JSON object with exactly these keys:

{{
  "meeting_title"       : "string",
  "date"                : "string",
  "time"                : "string",
  "venue"               : "string",
  "chaired_by"          : "string",
  "attendees"           : ["list of names"],
  "agenda_items"        : ["list of agenda items"],
  "discussion_summary"  : [
      {{"topic": "string", "summary": "string", "speaker": "string or null"}}
  ],
  "decisions"           : [
      {{"decision": "string", "made_by": "string or null"}}
  ],
  "action_items"        : [
      {{"item": "string", "responsible": "string", "deadline": "string"}}
  ],
  "next_meeting"        : "string",
  "closing_remarks"     : "string",
  "additional_notes"    : "string"
}}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Module
# ─────────────────────────────────────────────────────────────────────────────

class LLMProcessor:
    """Interface to Ollama for MoM generation."""

    def __init__(self):
        self._base_url = settings.OLLAMA_BASE_URL
        self._model = settings.LLM_MODEL

    async def is_ready(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self._base_url}/api/tags")
            return r.status_code == 200
        except Exception:
            return False

    async def generate_mom(
        self,
        transcript: str,
        meeting_date: str,
        meeting_time: str,
        venue: str,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Send transcript to LLM and return parsed MoM dict."""
        if not transcript.strip():
            raise ValueError("Transcript is empty")

        prompt = USER_PROMPT_TEMPLATE.format(
            date=meeting_date,
            time=meeting_time,
            venue=venue,
            context=additional_context or "None provided",
            transcript=transcript,
        )

        logger.info(f"Sending transcript ({len(transcript)} chars) to {self._model} ...")

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "options": {
                "temperature": settings.LLM_TEMPERATURE,
                "num_predict": settings.LLM_MAX_TOKENS,
            },
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            response = await client.post(
                f"{self._base_url}/api/chat",
                json=payload,
            )

        if response.status_code != 200:
            raise RuntimeError(f"Ollama returned {response.status_code}: {response.text[:500]}")

        raw_text = response.json()["message"]["content"]
        logger.debug(f"LLM raw response length: {len(raw_text)}")

        parsed = safe_json_loads(raw_text)
        if not parsed:
            logger.warning("Could not parse LLM response as JSON – returning raw text")
            raise ValueError(f"LLM response could not be parsed as JSON:\n{raw_text[:500]}")

        return parsed
