"""Speaker identification and enrollment using SpeechBrain ECAPA-TDNN.

Allows voice enrollment of faculty members and maps
pyannote "SPEAKER_XX" labels to real names via cosine similarity.
"""
import json
import numpy as np
import torch
import torch.nn.functional as F
from pathlib import Path
from typing import Dict, Optional
from loguru import logger
from app.config import settings


class SpeakerIdentificationModule:
    """ECAPA-TDNN speaker verification + enrollment."""

    _PROFILES_FILE = "speaker_embeddings.json"

    def __init__(self):
        self._model = None
        self._enrolled: Dict[str, torch.Tensor] = {}    # name -> embedding
        self._profiles_path = settings.SPEAKER_PROFILES_DIR / self._PROFILES_FILE

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def load(self):
        from speechbrain.pretrained import SpeakerRecognition

        logger.info("Loading SpeechBrain ECAPA-TDNN speaker model...")
        self._model = SpeakerRecognition.from_hparams(
            source=settings.SPEECHBRAIN_MODEL,
            savedir=str(settings.MODELS_DIR / "speechbrain"),
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"},
        )
        self._load_profiles()
        logger.info(f"Speaker ID loaded  |  enrolled speakers: {list(self._enrolled.keys())}")

    # ── Public API ────────────────────────────────────────────────────────────

    def enroll(self, name: str, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Enroll a speaker with their voice sample. Returns True on success."""
        try:
            embedding = self._embed(audio, sample_rate)
            if name in self._enrolled:
                # Average with existing embedding for robustness
                self._enrolled[name] = F.normalize(
                    (self._enrolled[name] + embedding) / 2.0, dim=0
                )
            else:
                self._enrolled[name] = embedding
            self._save_profiles()
            logger.info(f"Enrolled speaker: {name}")
            return True
        except Exception as e:
            logger.error(f"Enrollment failed for {name}: {e}")
            return False

    def delete(self, name: str) -> bool:
        if name in self._enrolled:
            del self._enrolled[name]
            self._save_profiles()
            return True
        return False

    def list_speakers(self):
        return list(self._enrolled.keys())

    def identify(
        self, audio: np.ndarray, sample_rate: int = 16000, fallback: str = "Unknown"
    ) -> str:
        """Return speaker name if similarity > threshold, else fallback."""
        if not self._enrolled:
            return fallback

        try:
            embedding = self._embed(audio, sample_rate)
            best_name = fallback
            best_score = settings.SPEAKER_ID_THRESHOLD

            for name, enrolled_emb in self._enrolled.items():
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
        """Generate L2-normalised speaker embedding."""
        # SpeechBrain expects torch tensor [1, samples]
        tensor = torch.from_numpy(audio).float().unsqueeze(0)
        if torch.cuda.is_available():
            tensor = tensor.cuda()

        with torch.no_grad():
            embeddings = self._model.encode_batch(tensor)   # [1, 1, D]
        embedding = embeddings.squeeze()                     # [D]
        return F.normalize(embedding, dim=0).cpu()

    def _save_profiles(self):
        data = {name: emb.tolist() for name, emb in self._enrolled.items()}
        with open(self._profiles_path, "w") as f:
            json.dump(data, f)

    def _load_profiles(self):
        if self._profiles_path.exists():
            with open(self._profiles_path) as f:
                data = json.load(f)
            self._enrolled = {
                name: torch.tensor(emb) for name, emb in data.items()
            }
            logger.info(f"Loaded {len(self._enrolled)} enrolled speaker profiles")
