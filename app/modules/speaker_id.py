"""Speaker identification and enrollment using SpeechBrain ECAPA-TDNN.

Stores up to MAX_SAMPLES embeddings per speaker and identifies by max cosine
similarity across all stored samples — far more robust than a single embedding.
"""
import json
import numpy as np
import torch
import torch.nn.functional as F
from pathlib import Path
from typing import Dict, List, Optional
from loguru import logger
from app.config import settings

MAX_SAMPLES = 5  # max embeddings kept per speaker


class SpeakerIdentificationModule:
    """ECAPA-TDNN speaker verification + enrollment."""

    _PROFILES_FILE = "speaker_embeddings.json"

    def __init__(self):
        self._model = None
        self._enrolled: Dict[str, List[torch.Tensor]] = {}  # name -> list of embeddings
        self._profiles_path = settings.SPEAKER_PROFILES_DIR / self._PROFILES_FILE

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def load(self):
        from speechbrain.inference.speaker import SpeakerRecognition

        logger.info("Loading SpeechBrain ECAPA-TDNN speaker model...")
        self._model = SpeakerRecognition.from_hparams(
            source=settings.SPEECHBRAIN_MODEL,
            savedir=str(settings.MODELS_DIR / "speechbrain"),
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"},
        )
        self._load_profiles()
        enrolled_summary = {name: len(embs) for name, embs in self._enrolled.items()}
        logger.info(f"Speaker ID loaded  |  enrolled: {enrolled_summary}")

    # ── Public API ────────────────────────────────────────────────────────────

    def enroll(self, name: str, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Add one voice sample for a speaker. Call up to MAX_SAMPLES times for best accuracy."""
        try:
            embedding = self._embed(audio, sample_rate)
            if name not in self._enrolled:
                self._enrolled[name] = []
            self._enrolled[name].append(embedding)
            # Keep only the most recent MAX_SAMPLES
            if len(self._enrolled[name]) > MAX_SAMPLES:
                self._enrolled[name] = self._enrolled[name][-MAX_SAMPLES:]
            self._save_profiles()
            count = len(self._enrolled[name])
            logger.info(f"Enrolled speaker: {name}  ({count}/{MAX_SAMPLES} samples)")
            return True
        except Exception as e:
            logger.error(f"Enrollment failed for {name}: {e}")
            return False

    def sample_count(self, name: str) -> int:
        return len(self._enrolled.get(name, []))

    def delete(self, name: str) -> bool:
        if name in self._enrolled:
            del self._enrolled[name]
            self._save_profiles()
            return True
        return False

    def list_speakers(self):
        return list(self._enrolled.keys())

    def speaker_sample_counts(self) -> Dict[str, int]:
        return {name: len(embs) for name, embs in self._enrolled.items()}

    def identify(
        self, audio: np.ndarray, sample_rate: int = 16000, fallback: str = "Unknown"
    ) -> str:
        """Return speaker name if any stored embedding scores above threshold, else fallback."""
        if not self._enrolled:
            return fallback

        try:
            embedding = self._embed(audio, sample_rate)
            best_name = fallback
            best_score = settings.SPEAKER_ID_THRESHOLD

            for name, embeddings in self._enrolled.items():
                for enrolled_emb in embeddings:
                    score = F.cosine_similarity(
                        embedding.unsqueeze(0), enrolled_emb.unsqueeze(0)
                    ).item()
                    if score > best_score:
                        best_score = score
                        best_name = name

            return best_name
        except Exception as e:
            logger.warning(f"Speaker identification failed: {e}")
            return fallback

    # ── Internal ─────────────────────────────────────────────────────────────

    def _embed(self, audio: np.ndarray, sample_rate: int) -> torch.Tensor:
        tensor = torch.from_numpy(audio).float().unsqueeze(0)
        if torch.cuda.is_available():
            tensor = tensor.cuda()

        with torch.no_grad():
            embeddings = self._model.encode_batch(tensor)  # [1, 1, D]
        embedding = embeddings.squeeze()                    # [D]
        return F.normalize(embedding, dim=0).cpu()

    def _save_profiles(self):
        data = {name: [emb.tolist() for emb in embs] for name, embs in self._enrolled.items()}
        with open(self._profiles_path, "w") as f:
            json.dump(data, f)

    def _load_profiles(self):
        if not self._profiles_path.exists():
            return
        with open(self._profiles_path) as f:
            data = json.load(f)
        self._enrolled = {}
        for name, embs in data.items():
            if not embs:
                continue
            # Handle old format (single flat list = one embedding)
            if isinstance(embs[0], (int, float)):
                self._enrolled[name] = [torch.tensor(embs)]
            else:
                # New format: list of embeddings
                self._enrolled[name] = [torch.tensor(e) for e in embs]
        logger.info(f"Loaded {len(self._enrolled)} enrolled speaker profiles")
