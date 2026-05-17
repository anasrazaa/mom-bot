"""RAG module: semantic search over meeting transcripts.

Uses sentence-transformers (all-MiniLM-L6-v2, 22MB) + numpy cosine similarity.
Index is persisted to data/rag_index.json + data/rag_embeddings.npy.
"""
import json
from typing import List, Optional

import numpy as np
from loguru import logger

from app.config import settings

EMBED_DIM  = 384
CHUNK_SIZE = 200   # words per chunk
MIN_SCORE  = 0.25  # cosine similarity threshold

INDEX_FILE = settings.DATA_DIR / "rag_index.json"
EMBED_FILE = settings.DATA_DIR / "rag_embeddings.npy"


class RAGModule:
    def __init__(self):
        self._model = None
        self._index: List[dict] = []
        self._embeddings: Optional[np.ndarray] = None
        self._load_index()

    # ── Model ──────────────────────────────────────────────────────────────────

    def _load_model(self):
        if self._model is not None:
            return
        from sentence_transformers import SentenceTransformer
        logger.info("Loading RAG embedding model (all-MiniLM-L6-v2)…")
        self._model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("✓ RAG embedding model loaded")

    def _embed(self, texts: List[str]) -> np.ndarray:
        self._load_model()
        return self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load_index(self):
        if INDEX_FILE.exists() and EMBED_FILE.exists():
            try:
                self._index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
                self._embeddings = np.load(str(EMBED_FILE))
                logger.info(f"RAG index loaded: {len(self._index)} chunks")
            except Exception as exc:
                logger.warning(f"RAG index corrupt, resetting: {exc}")
                self._index = []
                self._embeddings = None
        else:
            self._index = []
            self._embeddings = None

    def _save_index(self):
        INDEX_FILE.write_text(
            json.dumps(self._index, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if self._embeddings is not None:
            np.save(str(EMBED_FILE), self._embeddings)

    # ── Chunking ──────────────────────────────────────────────────────────────

    @staticmethod
    def _chunk_text(text: str) -> List[str]:
        words = text.split()
        return [
            " ".join(words[i : i + CHUNK_SIZE])
            for i in range(0, len(words), CHUNK_SIZE)
            if words[i : i + CHUNK_SIZE]
        ]

    # ── Public API ────────────────────────────────────────────────────────────

    def index_meeting(self, meeting_id: str, meeting_title: str, transcript_text: str):
        """Index (or re-index) a meeting transcript. Called after meeting stops."""
        self.delete_meeting(meeting_id)  # idempotent

        chunks = self._chunk_text(transcript_text)
        if not chunks:
            logger.info(f"RAG: nothing to index for {meeting_id}")
            return

        try:
            embeddings = self._embed(chunks)
        except Exception as exc:
            logger.error(f"RAG embedding failed for {meeting_id}: {exc}")
            return

        new_entries = [
            {"meeting_id": meeting_id, "meeting_title": meeting_title, "chunk_id": i, "text": c}
            for i, c in enumerate(chunks)
        ]
        self._index.extend(new_entries)
        self._embeddings = (
            embeddings if self._embeddings is None
            else np.vstack([self._embeddings, embeddings])
        )
        self._save_index()
        logger.info(f"RAG indexed '{meeting_title}': {len(chunks)} chunks")

    def delete_meeting(self, meeting_id: str):
        """Remove all chunks for a meeting from the index."""
        keep = [i for i, e in enumerate(self._index) if e["meeting_id"] != meeting_id]
        if len(keep) == len(self._index):
            return
        self._index = [self._index[i] for i in keep]
        if len(keep) == 0:
            self._embeddings = None
        elif self._embeddings is not None:
            self._embeddings = self._embeddings[keep]
        self._save_index()

    def search(
        self,
        query: str,
        top_k: int = 5,
        meeting_id: Optional[str] = None,
    ) -> List[dict]:
        """Return top-k relevant chunks for a query, optionally scoped to one meeting."""
        if not self._index or self._embeddings is None:
            return []

        try:
            q_emb = self._embed([query])[0]
        except Exception as exc:
            logger.error(f"RAG query embedding failed: {exc}")
            return []

        if meeting_id:
            indices = [i for i, e in enumerate(self._index) if e["meeting_id"] == meeting_id]
            if not indices:
                return []
            embs   = self._embeddings[indices]
            scores = embs @ q_emb
            top_local = np.argsort(scores)[::-1][:top_k]
            results = [
                {**self._index[indices[li]], "score": float(scores[li])}
                for li in top_local
            ]
        else:
            scores      = self._embeddings @ q_emb
            top_indices = np.argsort(scores)[::-1][:top_k]
            results     = [
                {**self._index[i], "score": float(scores[i])}
                for i in top_indices
            ]

        return [r for r in results if r["score"] >= MIN_SCORE]

    def indexed_meetings(self) -> List[str]:
        return list({e["meeting_id"] for e in self._index})


rag_module = RAGModule()
