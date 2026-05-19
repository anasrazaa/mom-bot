"""Speech-to-Text using faster-whisper (large-v3).

Supports Urdu, English, and mixed code-switching speech.
By default, transcript text is forced to English output.
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
    """faster-whisper STT with multilingual input and English transcript output."""

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
        text, _, _ = self.transcribe_segment_meta(audio, sample_rate)
        return text

    def transcribe_segment_meta(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> Tuple[str, Optional[float], str]:
        """Transcribe a single audio segment and return (text, confidence, language)."""
        if len(audio) < sample_rate * 0.1:
            return "", None, "unknown"
        segments = self._run(audio)
        if not segments:
            return "", None, "unknown"
        text = " ".join(s.text for s in segments).strip()
        conf = float(np.mean([s.confidence for s in segments]))
        lang = segments[0].language if segments else "unknown"
        return text, conf, lang

    def transcribe_with_timestamps(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> Tuple[List[TranscriptionSegment], str]:
        """Returns (segments_with_timestamps, detected_language)."""
        segments = self._run(audio)
        lang = segments[0].language if segments else "unknown"
        return segments, lang

    # ── Internal ─────────────────────────────────────────────────────────────

    _TARGET_RMS = 0.1  # normalise to ~-20 dBFS before transcription

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Bring audio to a consistent loudness level.
        Helps Whisper with quiet/distant microphone input without over-amplifying noise.
        """
        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms < 1e-4:  # effectively silent — don't amplify noise
            return audio
        scale = min(self._TARGET_RMS / rms, 5.0)  # cap gain at 5×
        return np.clip(audio * scale, -1.0, 1.0)

    def _run(self, audio: np.ndarray) -> List[TranscriptionSegment]:
        if self._model is None:
            raise RuntimeError("TranscriptionModule not loaded – call load() first")

        # faster-whisper expects float32 in [-1, 1]
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)
        audio = np.clip(audio, -1.0, 1.0)
        audio = self._normalize_audio(audio)

        candidates = self._candidate_languages()
        if len(candidates) == 1:
            return self._transcribe_with_language(audio, candidates[0])

        best_segments: List[TranscriptionSegment] = []
        best_score = float("-inf")
        best_language = "unknown"

        for language in candidates:
            segments = self._transcribe_with_language(audio, language)
            if not segments:
                continue
            score = float(np.mean([seg.confidence for seg in segments]))
            if score > best_score:
                best_segments = segments
                best_score = score
                best_language = language or segments[0].language

        if best_segments:
            logger.debug(f"Whisper language candidates={candidates} selected={best_language} score={best_score:.3f}")
        return best_segments

    def _candidate_languages(self) -> List[Optional[str]]:
        if settings.WHISPER_LANGUAGE:
            return [settings.WHISPER_LANGUAGE.strip().lower()]

        candidates = [
            language.strip().lower()
            for language in settings.WHISPER_ALLOWED_LANGUAGES.split(",")
            if language.strip()
        ]
        return candidates or [None]

    def _transcribe_with_language(self, audio: np.ndarray, language: Optional[str]) -> List[TranscriptionSegment]:
        task = "translate" if settings.WHISPER_FORCE_ENGLISH else "transcribe"

        segments, info = self._model.transcribe(
            audio,
            beam_size=settings.WHISPER_BEAM_SIZE,
            language=language,
            task=task,
            # ── Hallucination / quality controls ───────────────────────────
            condition_on_previous_text=False,        # prevent cascade hallucinations
            no_speech_threshold=settings.WHISPER_NO_SPEECH_THRESHOLD,
            log_prob_threshold=settings.WHISPER_LOG_PROB_THRESHOLD,
            compression_ratio_threshold=settings.WHISPER_COMPRESSION_RATIO_THRESHOLD,
            repetition_penalty=settings.WHISPER_REPETITION_PENALTY,
            # ── VAD: tighter thresholds for noisy / multi-speaker audio ────
            vad_filter=True,
            vad_parameters={
                "threshold": 0.5,              # Silero VAD speech probability cutoff
                "min_silence_duration_ms": 500, # merge segments across short silences
                "speech_pad_ms": 400,           # padding around detected speech
            },
        )

        result = []
        detected_lang = language or info.language
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
