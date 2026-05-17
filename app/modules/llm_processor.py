"""LLM processing via Ollama.

Sends meeting transcripts to a local Qwen2.5 / Llama3 model
and returns structured MoM data as JSON.
"""
import json
import httpx
from datetime import datetime
from typing import List, Optional
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
{agenda_section}
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

CHAT_SYSTEM = """\
You are a knowledgeable assistant for GIK Institute faculty meeting records. \
Answer questions using ONLY the context provided from meeting transcripts. \
If the answer is not in the context, say so clearly. Be concise and accurate.\
"""

SUMMARY_PROMPT = """\
Summarise the following meeting transcript in progress. Provide:
1. A 2-3 sentence overview of what has been discussed so far.
2. Key decisions made (bullet points, max 5).
3. Action items mentioned so far (who + what, max 5).

TRANSCRIPT SO FAR:
{transcript}

Return a JSON object:
{{
  "overview": "string",
  "decisions": ["string"],
  "action_items": ["string"]
}}
"""

PREP_PROMPT = """\
You are helping a chair prepare for an upcoming faculty meeting at GIK Institute.

AGENDA:
{agenda}

RELEVANT CONTEXT FROM PAST MEETINGS:
{context}

Produce a concise pre-meeting preparation brief with:
1. Key background on each agenda item (from past meetings).
2. Open action items related to agenda topics.
3. Potential discussion points or risks.

Return a JSON object:
{{
  "items": [
    {{
      "agenda_item": "string",
      "background": "string",
      "open_actions": ["string"],
      "watch_points": ["string"]
    }}
  ],
  "overall_notes": "string"
}}
"""


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
        agenda: Optional[List[str]] = None,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Send transcript to LLM and return parsed MoM dict."""
        if not transcript.strip():
            raise ValueError("Transcript is empty")

        agenda_section = ""
        if agenda:
            items = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(agenda))
            agenda_section = (
                f"MEETING AGENDA (provided by organiser — map discussion to these items,\n"
                f"note any items not covered or that ran over time):\n{items}\n"
            )

        prompt = USER_PROMPT_TEMPLATE.format(
            date=meeting_date,
            time=meeting_time,
            venue=venue,
            context=additional_context or "None provided",
            agenda_section=agenda_section,
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

    async def chat_rag(
        self,
        question: str,
        context_chunks: List[dict],
        history: Optional[List[dict]] = None,
    ) -> str:
        """Answer a question grounded in retrieved meeting transcript chunks."""
        if not context_chunks:
            context_text = "No relevant meeting records found."
        else:
            parts = []
            for c in context_chunks:
                parts.append(
                    f"[{c.get('meeting_title', 'Meeting')}]\n{c['text']}"
                )
            context_text = "\n\n---\n\n".join(parts)

        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        if history:
            messages.extend(history[-6:])  # keep last 3 turns
        messages.append({
            "role": "user",
            "content": (
                f"CONTEXT FROM MEETING RECORDS:\n{context_text}\n\n"
                f"QUESTION: {question}"
            ),
        })

        payload = {
            "model": self._model,
            "messages": messages,
            "options": {"temperature": 0.3, "num_predict": 1024},
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama {resp.status_code}: {resp.text[:300]}")
        return resp.json()["message"]["content"].strip()

    async def generate_summary(self, transcript_text: str) -> dict:
        """Produce a live/partial meeting summary from the current transcript."""
        if not transcript_text.strip():
            return {"overview": "No transcript yet.", "decisions": [], "action_items": []}

        prompt = SUMMARY_PROMPT.format(transcript=transcript_text[-8000:])
        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_predict": 1024},
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama {resp.status_code}: {resp.text[:300]}")

        raw = resp.json()["message"]["content"]
        parsed = safe_json_loads(raw)
        return parsed or {"overview": raw[:500], "decisions": [], "action_items": []}

    async def generate_prep_brief(
        self,
        agenda_items: List[str],
        context_chunks: List[dict],
    ) -> dict:
        """Generate a pre-meeting preparation brief using agenda + past meeting context."""
        agenda_text = "\n".join(f"{i+1}. {a}" for i, a in enumerate(agenda_items))
        if context_chunks:
            ctx_parts = [f"[{c.get('meeting_title','Meeting')}]\n{c['text']}" for c in context_chunks]
            context_text = "\n\n---\n\n".join(ctx_parts)
        else:
            context_text = "No relevant past meeting records found."

        prompt = PREP_PROMPT.format(agenda=agenda_text, context=context_text)
        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.3, "num_predict": 2048},
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama {resp.status_code}: {resp.text[:300]}")

        raw = resp.json()["message"]["content"]
        parsed = safe_json_loads(raw)
        return parsed or {"items": [], "overall_notes": raw[:500]}
