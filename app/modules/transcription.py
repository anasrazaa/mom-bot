"""Speech-to-Text using faster-whisper (large-v3).

Supports Urdu, English, and mixed code-switching speech.
Returns timestamped transcript segments.
"""
from typing import List, Optional, Tuple
import numpy as np
from loguru import logger
from faster_whisper import WhisperModel
from app.config import settings


class TranscriptionSegment:
    __slots__ = ("text", "start", "end", "language", "confidence")

    def __init__(self, text: str, start: float, end: float, language: str = "", confidence: float = 1.0):
        self.text = text.strip()
        self.start = start
        self.end = end
        self.language = language
        self.confidence = confidence

    def __repr__(self):
        return f"[{self.start:.1f}–{self.end:.1f}] ({self.language}) {self.text}"


class TranscriptionModule:
    """faster-whisper STT with multilingual support."""

    def __init__(self):
        self._model: Optional[WhisperModel] = None

    def load(self):
        logger.info(f"Loading Whisper model: {settings.WHISPER_MODEL} on {settings.WHISPER_DEVICE} ...")
        self._model = WhisperModel(
            settings.WHISPER_MODEL,
            device=settings.WHISPER_DEVICE,
            compute_type=settings.WHISPER_COMPUTE_TYPE,
            download_root=str(settings.MODELS_DIR / "whisper"),
        )
        logger.info("Whisper model loaded")

    def transcribe_segment(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe a single audio segment. Returns plain text."""
        if len(audio) < sample_rate * 0.1:
            return ""
        segments = self._run(audio)
        return " ".join(s.text for s in segments).strip()

    def transcribe_with_timestamps(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> Tuple[List[TranscriptionSegment], str]:
        """Returns (segments_with_timestamps, detected_language)."""
        segments = self._run(audio)
        lang = segments[0].language if segments else "unknown"
        return segments, lang

    # ── Internal ─────────────────────────────────────────────────────────────

    def _run(self, audio: np.ndarray) -> List[TranscriptionSegment]:
        if self._model is None:
            raise RuntimeError("TranscriptionModule not loaded – call load() first")

        # faster-whisper expects float32 in [-1, 1]
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)
        audio = np.clip(audio, -1.0, 1.0)

        segments, info = self._model.transcribe(
            audio,
            beam_size=settings.WHISPER_BEAM_SIZE,
            language=settings.WHISPER_LANGUAGE,   # None = auto-detect
            task="transcribe",                     # keep source language
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )

        result = []
        detected_lang = info.language
        for seg in segments:
            if seg.text.strip():
                result.append(
                    TranscriptionSegment(
                        text=seg.text,
                        start=seg.start,
                        end=seg.end,
                        language=detected_lang,
                        confidence=seg.avg_logprob,
                    )
                )
        return result
