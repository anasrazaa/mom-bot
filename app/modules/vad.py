"""Voice Activity Detection using Silero VAD."""
from typing import List, Optional

import numpy as np
import torch
from loguru import logger


class VADProcessor:
    """Silero VAD – detects speech segments in audio."""

    SILERO_REPO = "snakers4/silero-vad"
    SILERO_MODEL = "silero_vad"

    def __init__(self):
        self._model = None
        self._utils = None

    def load(self):
        logger.info("Loading Silero VAD model...")
        self._model, self._utils = torch.hub.load(
            repo_or_dir=self.SILERO_REPO,
            model=self.SILERO_MODEL,
            trust_repo=True,
        )
        self._model.eval()
        if torch.cuda.is_available():
            self._model = self._model.cuda()
        logger.info("Silero VAD loaded")

    @property
    def _get_speech_timestamps(self):
        (get_speech_timestamps, _, _, _, _) = self._utils
        return get_speech_timestamps

    def has_speech(self, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Return True if audio contains any speech."""
        timestamps = self.get_segments(audio, sample_rate)
        return len(timestamps) > 0

    def get_segments(self, audio: np.ndarray, sample_rate: int = 16000) -> list:
        """Return list of (start_sec, end_sec) speech segments."""
        tensor = torch.from_numpy(audio).float()
        if torch.cuda.is_available():
            tensor = tensor.cuda()

        timestamps = self._get_speech_timestamps(
            tensor,
            self._model,
            sampling_rate=sample_rate,
            threshold=0.4,
            min_speech_duration_ms=250,
            min_silence_duration_ms=100,
            return_seconds=True,
        )
        return [(t["start"], t["end"]) for t in timestamps]


class StreamingVAD:
    """Stateful VAD for streaming audio — detects speech boundaries.

    Call push() for each incoming audio chunk.  Returns a complete
    speech segment (np.ndarray) when a speech→silence boundary is
    detected, otherwise returns None.  Call flush() on meeting stop
    to retrieve any remaining buffered speech.
    """

    def __init__(
        self,
        vad_processor: "VADProcessor",
        sample_rate: int = 16000,
        silence_ms: int = 400,
        max_segment_sec: float = 20.0,
        min_segment_sec: float = 0.4,
    ):
        self._vad = vad_processor
        self._sr = sample_rate
        self._silence_frames = int(silence_ms / 1000 * sample_rate)
        self._max_frames = int(max_segment_sec * sample_rate)
        self._min_frames = int(min_segment_sec * sample_rate)
        self._reset()

    # ── Public API ────────────────────────────────────────────────────────────

    def push(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """Feed a chunk of audio. Returns a segment when boundary detected."""
        has_speech = self._vad.has_speech(audio, self._sr)

        if has_speech:
            self._buffer.append(audio)
            self._buffer_len += len(audio)
            self._silence_len = 0
            self._in_speech = True
            if self._buffer_len >= self._max_frames:
                return self._flush_buffer()
        elif self._in_speech:
            # Trailing silence — keep in buffer until threshold crossed
            self._buffer.append(audio)
            self._buffer_len += len(audio)
            self._silence_len += len(audio)
            if self._silence_len >= self._silence_frames:
                return self._flush_buffer()

        return None

    def flush(self) -> Optional[np.ndarray]:
        """Force-flush remaining buffered speech (call on meeting stop)."""
        if self._in_speech and self._buffer_len >= self._min_frames:
            return self._flush_buffer()
        self._reset()
        return None

    # ── Internal ─────────────────────────────────────────────────────────────

    def _flush_buffer(self) -> Optional[np.ndarray]:
        combined = np.concatenate(self._buffer)
        self._reset()
        if len(combined) >= self._min_frames:
            return combined
        return None

    def _reset(self):
        self._buffer: List[np.ndarray] = []
        self._buffer_len: int = 0
        self._silence_len: int = 0
        self._in_speech: bool = False
