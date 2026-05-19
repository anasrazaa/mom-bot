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

HANDBOOK_CHAT_SYSTEM = """\
You are an expert assistant on GIK Institute faculty policies and regulations. \
You have access to the official GIK Faculty Handbook. \
Answer questions accurately based ONLY on the provided handbook excerpts. \
If the answer is not found in the provided excerpts, clearly state that and suggest \
the user consult the full handbook or the relevant department. \
Be concise, formal, and helpful. Quote page numbers when available.\
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

# ── Chunked-transcript prompts (for long meetings) ────────────────────────────

SEGMENT_SUMMARY_PROMPT = """\
You are processing ONE SEGMENT of a long faculty meeting transcript. \
Extract the key points from this segment only — do not fabricate anything.
Text may be in English, Urdu (Roman or Arabic script), or a mix; translate Urdu accurately.

SEGMENT {seg_num} OF {total_segs}  |  Approximate time: {time_range}
-----------
{transcript_segment}
-----------

Return a JSON object:
{{
  "attendees_mentioned": ["names mentioned in this segment"],
  "discussion_points": [
    {{"topic": "string", "summary": "string", "speaker": "string or null"}}
  ],
  "decisions": ["string"],
  "action_items": [
    {{"item": "string", "responsible": "string or null", "deadline": "string or null"}}
  ]
}}
"""

MERGE_SEGMENTS_PROMPT = """\
You are given summaries of {n} consecutive segments of a faculty meeting.
Merge them into a single structured Minutes of Meeting document.
Remove duplicates and keep the chronological order of discussion.

MEETING DATE  : {date}
MEETING TIME  : {time}
VENUE         : {venue}
ADDITIONAL CTX: {context}
{agenda_section}
SEGMENT SUMMARIES:
==================
{merged_summaries}
==================

Return the final MoM as a single JSON object with exactly these keys:

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

DRAFT_POINTS_PROMPT_TEMPLATE = """\
Extract editable MoM draft points from the meeting transcript.

MEETING DATE  : {date}
MEETING TIME  : {time}
VENUE         : {venue}
ADDITIONAL CTX: {context}
{agenda_section}
TRANSCRIPT:
-----------
{transcript}
-----------

Return JSON with exactly these keys:
{{
    "meeting_title": "string",
    "chaired_by": "string",
    "attendees": ["string"],
    "agenda_items": ["string"],
    "discussion_points": [
        {{"topic": "string", "summary": "string", "speaker": "string or null"}}
    ],
    "decisions": ["string"],
    "action_items": [
        {{"item": "string", "responsible": "string", "deadline": "string"}}
    ],
    "closing_remarks": "string",
    "additional_notes": "string"
}}
"""

FINAL_FROM_DRAFT_PROMPT_TEMPLATE = """\
Generate final Minutes of Meeting JSON using the user-edited draft points below.

MEETING DATE  : {date}
MEETING TIME  : {time}
VENUE         : {venue}
ADDITIONAL CTX: {context}

USER-EDITED DRAFT POINTS (authoritative):
-----------
{draft_points}
-----------

TRANSCRIPT (for factual consistency check only):
-----------
{transcript}
-----------

Rules:
1. Prioritise the user-edited draft points.
2. Keep the final MoM concise, formal, and in English.
3. Do not add facts not present in either draft points or transcript.
4. Return JSON with the same schema as standard MoM generation.
"""


class LLMProcessor:
    """Interface to Ollama for MoM generation."""

    def __init__(self):
        self._base_url = settings.OLLAMA_BASE_URL
        self._model = settings.LLM_MODEL

    def _opts(self, temperature: float = None, num_predict: int = None) -> dict:
        """Build Ollama options dict — always includes num_ctx."""
        return {
            "temperature": temperature if temperature is not None else settings.LLM_TEMPERATURE,
            "num_predict": num_predict if num_predict is not None else settings.LLM_MAX_TOKENS,
            "num_ctx":     settings.LLM_NUM_CTX,
        }

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
        """Send transcript to LLM and return parsed MoM dict.

        Automatically switches to chunked hierarchical summarization when the
        transcript exceeds LLM_CHUNK_CHARS to ensure every minute of a long
        meeting is fully covered.
        """
        if not transcript.strip():
            raise ValueError("Transcript is empty")

        if len(transcript) > settings.LLM_CHUNK_CHARS:
            logger.info(
                f"Transcript is {len(transcript):,} chars — using chunked summarization "
                f"(threshold: {settings.LLM_CHUNK_CHARS:,} chars)"
            )
            return await self._generate_mom_chunked(
                transcript, meeting_date, meeting_time, venue, agenda, additional_context
            )

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

        logger.info(f"Sending transcript ({len(transcript):,} chars) to {self._model} ...")

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            "options": self._opts(),
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

    async def _generate_mom_chunked(
        self,
        transcript: str,
        meeting_date: str,
        meeting_time: str,
        venue: str,
        agenda: Optional[List[str]] = None,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Hierarchical summarization for long transcripts.

        Pass 1: Summarize each ~CHUNK_CHARS segment independently.
        Pass 2: Merge all segment summaries into the final structured MoM.
        """
        # ── Split transcript into overlapping segments ──────────────────────
        chunk_size = settings.LLM_CHUNK_CHARS // 2  # conservative: half the limit
        overlap    = chunk_size // 10               # 10% overlap at boundaries
        lines = transcript.split("\n")
        segments: List[str] = []
        buf: List[str] = []
        buf_len = 0
        for line in lines:
            buf.append(line)
            buf_len += len(line) + 1
            if buf_len >= chunk_size:
                segments.append("\n".join(buf))
                # keep last ~overlap chars worth of lines for continuity
                carry_lines: List[str] = []
                carry_len = 0
                for l in reversed(buf):
                    carry_len += len(l) + 1
                    carry_lines.insert(0, l)
                    if carry_len >= overlap:
                        break
                buf = carry_lines
                buf_len = carry_len
        if buf:
            segments.append("\n".join(buf))

        total = len(segments)
        logger.info(f"Transcript split into {total} segments for chunked summarization")

        # ── Pass 1: summarize each segment ──────────────────────────────────
        seg_summaries: List[str] = []
        for i, seg in enumerate(segments):
            # Estimate time range from first/last timestamp in segment
            first_ts = seg.split("]")[0].lstrip("[") if "]" in seg else "?"
            last_ts_parts = [l.split("]")[0].lstrip("[") for l in seg.split("\n") if "]" in l]
            time_range = f"{first_ts} – {last_ts_parts[-1]}" if last_ts_parts else "unknown"

            prompt = SEGMENT_SUMMARY_PROMPT.format(
                seg_num=i + 1,
                total_segs=total,
                time_range=time_range,
                transcript_segment=seg,
            )
            payload = {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                "options": self._opts(temperature=0.1, num_predict=2048),
                "stream": False,
            }
            logger.info(f"Summarizing segment {i+1}/{total} ({len(seg):,} chars)...")
            async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
                r = await client.post(f"{self._base_url}/api/chat", json=payload)
            if r.status_code != 200:
                raise RuntimeError(f"Ollama segment {i+1} error {r.status_code}: {r.text[:300]}")
            seg_summaries.append(r.json()["message"]["content"].strip())

        # ── Pass 2: merge segment summaries into final MoM ──────────────────
        agenda_section = ""
        if agenda:
            items = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(agenda))
            agenda_section = f"MEETING AGENDA:\n{items}\n"

        merged = "\n\n".join(
            f"--- SEGMENT {i+1} ---\n{s}" for i, s in enumerate(seg_summaries)
        )
        merge_prompt = MERGE_SEGMENTS_PROMPT.format(
            n=total,
            date=meeting_date,
            time=meeting_time,
            venue=venue,
            context=additional_context or "None provided",
            agenda_section=agenda_section,
            merged_summaries=merged,
        )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": merge_prompt},
            ],
            "options": self._opts(),
            "stream": False,
        }
        logger.info("Merging segment summaries into final MoM...")
        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            r = await client.post(f"{self._base_url}/api/chat", json=payload)
        if r.status_code != 200:
            raise RuntimeError(f"Ollama merge error {r.status_code}: {r.text[:300]}")

        raw_text = r.json()["message"]["content"]
        parsed = safe_json_loads(raw_text)
        if not parsed:
            raise ValueError(f"Chunked MoM merge response is not valid JSON:\n{raw_text[:500]}")
        return parsed

    async def generate_mom_draft_points(
        self,
        transcript: str,
        meeting_date: str,
        meeting_time: str,
        venue: str,
        agenda: Optional[List[str]] = None,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Extract editable MoM draft points from transcript."""
        if not transcript.strip():
            raise ValueError("Transcript is empty")

        agenda_section = ""
        if agenda:
            items = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(agenda))
            agenda_section = f"MEETING AGENDA:\n{items}\n"

        prompt = DRAFT_POINTS_PROMPT_TEMPLATE.format(
            date=meeting_date,
            time=meeting_time,
            venue=venue,
            context=additional_context or "None provided",
            agenda_section=agenda_section,
            transcript=transcript,
        )

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            "options": self._opts(temperature=0.1),
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            response = await client.post(f"{self._base_url}/api/chat", json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"Ollama returned {response.status_code}: {response.text[:500]}")

        raw_text = response.json()["message"]["content"]
        parsed = safe_json_loads(raw_text)
        if not parsed:
            raise ValueError(f"LLM draft-point response is not valid JSON:\n{raw_text[:500]}")
        return parsed

    async def generate_mom_from_draft_points(
        self,
        transcript: str,
        draft_points: dict,
        meeting_date: str,
        meeting_time: str,
        venue: str,
        additional_context: Optional[str] = None,
    ) -> dict:
        """Generate final MoM JSON from user-edited draft points plus transcript."""
        if not transcript.strip():
            raise ValueError("Transcript is empty")

        prompt = FINAL_FROM_DRAFT_PROMPT_TEMPLATE.format(
            date=meeting_date,
            time=meeting_time,
            venue=venue,
            context=additional_context or "None provided",
            draft_points=json.dumps(draft_points, ensure_ascii=False, indent=2),
            transcript=transcript,
        )

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            "options": self._opts(),
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            response = await client.post(f"{self._base_url}/api/chat", json=payload)

        if response.status_code != 200:
            raise RuntimeError(f"Ollama returned {response.status_code}: {response.text[:500]}")

        raw_text = response.json()["message"]["content"]
        parsed = safe_json_loads(raw_text)
        if not parsed:
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
            "options": self._opts(temperature=0.3, num_predict=1024),
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama {resp.status_code}: {resp.text[:300]}")
        return resp.json()["message"]["content"].strip()

    async def chat_handbook(
        self,
        question: str,
        context_chunks: List[dict],
        history: Optional[List[dict]] = None,
    ) -> str:
        """Answer a question grounded in Faculty Handbook excerpts."""
        if not context_chunks:
            context_text = "No relevant handbook sections found for this query."
        else:
            parts = []
            for c in context_chunks:
                page_ref = f"  [Page {c['page']}]" if c.get("page") else ""
                parts.append(f"{c['text']}{page_ref}")
            context_text = "\n\n---\n\n".join(parts)

        messages = [{"role": "system", "content": HANDBOOK_CHAT_SYSTEM}]
        if history:
            messages.extend(history[-6:])
        messages.append({
            "role": "user",
            "content": (
                f"HANDBOOK EXCERPTS:\n{context_text}\n\n"
                f"QUESTION: {question}"
            ),
        })

        payload = {
            "model": self._model,
            "messages": messages,
            "options": self._opts(temperature=0.2, num_predict=1024),
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
            "options": self._opts(temperature=0.2, num_predict=1024),
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
            "options": self._opts(temperature=0.3, num_predict=2048),
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            resp = await client.post(f"{self._base_url}/api/chat", json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama {resp.status_code}: {resp.text[:300]}")

        raw = resp.json()["message"]["content"]
        parsed = safe_json_loads(raw)
        return parsed or {"items": [], "overall_notes": raw[:500]}
