"""Speaker diarization using pyannote.audio 3.x.

Returns a list of (start_sec, end_sec, speaker_label) tuples
for each detected speaker turn.
"""
from typing import List, Optional, Tuple
import numpy as np
import torch
from loguru import logger
from app.config import settings


class DiarizationModule:
    """pyannote.audio speaker diarization pipeline."""

    def __init__(self):
        self._pipeline = None

    def load(self):
        from pyannote.audio import Pipeline

        logger.info("Loading pyannote diarization pipeline...")
        if not settings.PYANNOTE_HF_TOKEN:
            logger.warning(
                "PYANNOTE_HF_TOKEN is empty – pyannote models may not download. "
                "Set it in .env for first-time model download."
            )

        self._pipeline = Pipeline.from_pretrained(
            settings.PYANNOTE_MODEL,
            use_auth_token=settings.PYANNOTE_HF_TOKEN or None,
            cache_dir=str(settings.MODELS_DIR / "pyannote"),
        )

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._pipeline = self._pipeline.to(device)
        logger.info(f"Pyannote diarization loaded on {device}")

    def diarize(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000,
        max_speakers: Optional[int] = None,
    ) -> List[Tuple[float, float, str]]:
        """
        Diarize audio and return sorted list of (start, end, speaker_label).
        speaker_label is like "SPEAKER_00", "SPEAKER_01", ...
        max_speakers overrides the config value when provided.
        """
        if self._pipeline is None:
            raise RuntimeError("DiarizationModule not loaded – call load() first")

        if len(audio) < sample_rate * 1.0:
            # Too short for meaningful diarization
            return [(0.0, len(audio) / sample_rate, "SPEAKER_00")]

        audio_tensor = torch.from_numpy(audio).unsqueeze(0).float()
        input_dict = {"waveform": audio_tensor, "sample_rate": sample_rate}

        effective_max = max_speakers if max_speakers is not None else settings.DIARIZATION_MAX_SPEAKERS

        diarization = self._pipeline(
            input_dict,
            min_speakers=settings.DIARIZATION_MIN_SPEAKERS,
            max_speakers=effective_max,
        )

        segments: List[Tuple[float, float, str]] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append((turn.start, turn.end, speaker))

        segments.sort(key=lambda x: x[0])
        return segments

    @staticmethod
    def merge_short_segments(
        segments: List[Tuple[float, float, str]],
        min_duration: float = 0.3,
    ) -> List[Tuple[float, float, str]]:
        """Merge consecutive segments from the same speaker and drop sub-300ms artefacts."""
        if not segments:
            return []

        merged = []
        cur_start, cur_end, cur_spk = segments[0]

        for start, end, spk in segments[1:]:
            if spk == cur_spk and (start - cur_end) < 0.5:
                cur_end = max(cur_end, end)
            else:
                if (cur_end - cur_start) >= min_duration:
                    merged.append((cur_start, cur_end, cur_spk))
                cur_start, cur_end, cur_spk = start, end, spk

        if (cur_end - cur_start) >= min_duration:
            merged.append((cur_start, cur_end, cur_spk))

        return merged
