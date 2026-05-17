"""Transcript post-processing: fast regex pass + optional async LLM pass."""
import re
from typing import Optional

import httpx
from loguru import logger

# ── Regex patterns ────────────────────────────────────────────────────────────

_FILLERS = re.compile(
    r"\b(um+|uh+|er+|ah+|hmm+|ehh?|umm+|uhh+|"
    r"you know|i mean|basically|literally|actually|"
    r"right\?|okay so|so um|so uh|kind of|sort of)\b[,.]?\s*",
    re.IGNORECASE,
)
# Consecutive word repetitions: "the the the" → "the"
_WORD_REP = re.compile(r"\b(\w+)(\s+\1){1,}\b", re.IGNORECASE)
# Space before punctuation
_PUNC_SPACE = re.compile(r"\s+([,.])")


def clean_fast(text: str) -> str:
    """Regex-only cleanup — zero latency, applied before every broadcast."""
    if not text:
        return text
    text = _FILLERS.sub(" ", text)
    text = _WORD_REP.sub(r"\1", text)
    text = _PUNC_SPACE.sub(r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    if text:
        text = text[0].upper() + text[1:]
    return text


async def clean_llm(text: str, ollama_url: str, model: str) -> Optional[str]:
    """LLM cleanup via Ollama — async, ~1–3 s latency.

    Returns cleaned text, or None if Ollama is unavailable/slow.
    """
    if not text.strip():
        return None

    prompt = (
        "Fix this meeting transcript excerpt: remove filler words, fix "
        "repetitions, improve punctuation. Preserve meaning and speaker "
        "language (Urdu/English mix is fine). "
        "Return ONLY the corrected text — no explanation.\n\n"
        f"Input: {text}\nOutput:"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            cleaned = r.json().get("response", "").strip()
            return cleaned if cleaned else None
    except Exception as exc:
        logger.debug(f"LLM transcript cleanup skipped: {exc}")
        return None
