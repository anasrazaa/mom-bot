"""Voice Activity Detection using Silero VAD."""
import torch
import numpy as np
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
