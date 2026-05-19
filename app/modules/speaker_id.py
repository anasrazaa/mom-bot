"""Speaker identification and enrollment using SpeechBrain ECAPA-TDNN.

Two accuracy improvements over plain cosine similarity:

1. Centroid matching — all enrolled samples for a speaker are averaged into
   a single centroid vector.  This is more robust than max-similarity because
   a single noisy enrollment sample cannot dominate the score.

2. Temporal tracker (SpeakerTracker) — maintains a short window of recent
   identifications.  Once a speaker is confirmed, subsequent segments within
   that window receive a small score boost, preventing label-flipping caused
   by momentary noise.
"""
import json
import threading
from typing import Dict, List, Optional

import numpy as np
import torch
import torch.nn.functional as F
from loguru import logger

from app.config import settings

MAX_SAMPLES = 5   # max embeddings kept per speaker


# ─────────────────────────────────────────────────────────────────────────────
# Temporal tracker
# ─────────────────────────────────────────────────────────────────────────────

class SpeakerTracker:
    """Per-meeting temporal speaker consistency tracker.

    Thread-safe (pipeline processes audio in a thread-pool).

    After a speaker is identified with confidence, the next WINDOW segments
    receive a BOOST additive boost toward that speaker's score, reducing
    flip-flopping caused by short or noisy utterances.
    """

    WINDOW = 6    # recent segments remembered (increased from 4)
    BOOST  = 0.18 # additive cosine-score boost (increased from 0.12)

    def __init__(self):
        self._history: List[str] = []
        self._lock = threading.Lock()

    def record(self, speaker: str):
        with self._lock:
            self._history.append(speaker)
            if len(self._history) > self.WINDOW:
                self._history.pop(0)

    def apply_boost(self, scores: Dict[str, float]) -> Dict[str, float]:
        """Return a copy of scores with recency bias applied."""
        with self._lock:
            history = list(self._history)
        if not history:
            return scores
        boosted = dict(scores)
        n = len(history)
        for i, spk in enumerate(history):
            if spk in boosted:
                # Older items get less weight: history[0] = oldest
                weight = (i + 1) / n
                boosted[spk] += self.BOOST * weight
        return boosted

    def reset(self):
        with self._lock:
            self._history.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Speaker identification module
# ─────────────────────────────────────────────────────────────────────────────

class SpeakerIdentificationModule:
    """ECAPA-TDNN speaker verification + enrollment.

    Identification uses centroid matching: all enrolled embeddings for a
    speaker are averaged before comparison, making the model robust to
    individual noisy samples.
    """

    _PROFILES_FILE = "speaker_embeddings.json"

    def __init__(self):
        self._model = None
        self._enrolled: Dict[str, List[torch.Tensor]] = {}  # name -> embeddings
        self._centroids: Dict[str, torch.Tensor] = {}       # name -> mean embedding
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
        self._rebuild_centroids()
        enrolled_summary = {name: len(embs) for name, embs in self._enrolled.items()}
        logger.info(f"Speaker ID loaded  |  enrolled: {enrolled_summary}")

    # ── Public API ────────────────────────────────────────────────────────────

    def enroll(self, name: str, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Add one voice sample. Call up to MAX_SAMPLES times for best accuracy."""
        try:
            embedding = self._embed(audio, sample_rate)
            if name not in self._enrolled:
                self._enrolled[name] = []
            self._enrolled[name].append(embedding)
            if len(self._enrolled[name]) > MAX_SAMPLES:
                self._enrolled[name] = self._enrolled[name][-MAX_SAMPLES:]
            self._rebuild_centroids()
            self._save_profiles()
            count = len(self._enrolled[name])
            logger.info(f"Enrolled speaker: {name}  ({count}/{MAX_SAMPLES} samples)")
            return True
        except Exception as exc:
            logger.error(f"Enrollment failed for {name}: {exc}")
            return False

    def identify(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000,
        fallback: str = "Unknown",
        tracker: Optional[SpeakerTracker] = None,
    ) -> str:
        """Return the best-matching enrolled speaker name, or fallback.

        Uses centroid matching.  If a SpeakerTracker is supplied, applies a
        recency boost to scores before thresholding.
        """
        if not self._centroids:
            return fallback

        try:
            query = self._embed(audio, sample_rate)

            # Raw cosine similarity against each speaker's centroid
            scores: Dict[str, float] = {}
            for name, centroid in self._centroids.items():
                scores[name] = F.cosine_similarity(
                    query.unsqueeze(0), centroid.unsqueeze(0)
                ).item()

            # Apply temporal boost (if tracker provided)
            if tracker is not None:
                scores = tracker.apply_boost(scores)

            best_name = max(scores, key=scores.get)
            best_score = scores[best_name]

            if best_score >= settings.SPEAKER_ID_THRESHOLD:
                if tracker is not None:
                    tracker.record(best_name)
                return best_name

            return fallback
        except Exception as exc:
            logger.warning(f"Speaker identification failed: {exc}")
            return fallback

    def sample_count(self, name: str) -> int:
        return len(self._enrolled.get(name, []))

    def delete(self, name: str) -> bool:
        if name in self._enrolled:
            del self._enrolled[name]
            self._centroids.pop(name, None)
            self._save_profiles()
            return True
        return False

    def list_speakers(self):
        return list(self._enrolled.keys())

    def speaker_sample_counts(self) -> Dict[str, int]:
        return {name: len(embs) for name, embs in self._enrolled.items()}

    # ── Internal ─────────────────────────────────────────────────────────────

    def _embed(self, audio: np.ndarray, sample_rate: int) -> torch.Tensor:
        # Normalize loudness so quiet / far-from-mic audio produces
        # embeddings of consistent quality.
        rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))
        if rms > 1e-4:
            scale = min(0.1 / rms, 5.0)
            audio = np.clip(audio.astype(np.float32) * scale, -1.0, 1.0)

        tensor = torch.from_numpy(audio).float().unsqueeze(0)
        if torch.cuda.is_available():
            tensor = tensor.cuda()
        with torch.no_grad():
            embeddings = self._model.encode_batch(tensor)  # [1, 1, D]
        embedding = embeddings.squeeze()                    # [D]
        return F.normalize(embedding, dim=0).cpu()

    def _rebuild_centroids(self):
        """Recompute the mean (centroid) embedding for every enrolled speaker."""
        self._centroids = {}
        for name, embs in self._enrolled.items():
            if embs:
                centroid = torch.stack(embs).mean(dim=0)
                self._centroids[name] = F.normalize(centroid, dim=0)

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
                self._enrolled[name] = [torch.tensor(e) for e in embs]
        logger.info(f"Loaded {len(self._enrolled)} enrolled speaker profiles")
