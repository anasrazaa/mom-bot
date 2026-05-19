"""Handbook RAG module: semantic search over the Faculty Handbook PDF.

Completely separate from the meeting transcript RAG.
Uses the same embedding model (all-MiniLM-L6-v2) but a different index.
"""
import hashlib
import json
from pathlib import Path
from typing import List, Optional

import numpy as np
from loguru import logger

from app.config import settings

CHUNK_SIZE = 250   # words per chunk
OVERLAP    = 50    # word overlap between chunks for better context
MIN_SCORE  = 0.20

HANDBOOK_INDEX_FILE = settings.DATA_DIR / "handbook_index.json"
HANDBOOK_EMBED_FILE = settings.DATA_DIR / "handbook_embeddings.npy"
HANDBOOK_META_FILE  = settings.DATA_DIR / "handbook_meta.json"


class HandbookRAG:
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
        logger.info("Loading handbook RAG embedding model…")
        self._model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("✓ Handbook RAG embedding model loaded")

    def _embed(self, texts: List[str]) -> np.ndarray:
        self._load_model()
        return self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load_index(self):
        if HANDBOOK_INDEX_FILE.exists() and HANDBOOK_EMBED_FILE.exists():
            try:
                self._index = json.loads(HANDBOOK_INDEX_FILE.read_text(encoding="utf-8"))
                self._embeddings = np.load(str(HANDBOOK_EMBED_FILE))
                logger.info(f"Handbook RAG index loaded: {len(self._index)} chunks")
            except Exception as exc:
                logger.warning(f"Handbook RAG index corrupt, will re-index: {exc}")
                self._index = []
                self._embeddings = None
        else:
            self._index = []
            self._embeddings = None

    def _save_index(self):
        HANDBOOK_INDEX_FILE.write_text(
            json.dumps(self._index, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if self._embeddings is not None:
            np.save(str(HANDBOOK_EMBED_FILE), self._embeddings)

    def _pdf_hash(self, pdf_path: Path) -> str:
        h = hashlib.md5()
        with open(pdf_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    def needs_indexing(self, pdf_path: Path) -> bool:
        """Return True if the PDF has changed or index is missing."""
        if not self._index or self._embeddings is None:
            return True
        if not HANDBOOK_META_FILE.exists():
            return True
        try:
            meta = json.loads(HANDBOOK_META_FILE.read_text(encoding="utf-8"))
            return meta.get("pdf_hash") != self._pdf_hash(pdf_path)
        except Exception:
            return True

    # ── Text Extraction ───────────────────────────────────────────────────────

    @staticmethod
    def _extract_pdf_text(pdf_path: Path) -> str:
        """Extract all text from a PDF using pypdf."""
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader  # fallback for older installs

        reader = PdfReader(str(pdf_path))
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"[Page {i + 1}]\n{text.strip()}")
        return "\n\n".join(pages)

    # ── Chunking ──────────────────────────────────────────────────────────────

    @staticmethod
    def _chunk_text(text: str) -> List[dict]:
        """Split text into overlapping chunks, preserving page numbers."""
        lines = text.split("\n")
        current_page = 1
        word_buffer: List[str] = []
        page_map: List[int] = []  # page number for each word

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("[Page ") and stripped.endswith("]"):
                try:
                    current_page = int(stripped[6:-1])
                except ValueError:
                    pass
                continue
            words = stripped.split()
            word_buffer.extend(words)
            page_map.extend([current_page] * len(words))

        chunks = []
        i = 0
        while i < len(word_buffer):
            end = min(i + CHUNK_SIZE, len(word_buffer))
            chunk_words = word_buffer[i:end]
            chunk_page = page_map[i] if i < len(page_map) else 1
            chunks.append({
                "text": " ".join(chunk_words),
                "page": chunk_page,
            })
            i += CHUNK_SIZE - OVERLAP  # overlap
            if i >= len(word_buffer):
                break

        return chunks

    # ── Public API ────────────────────────────────────────────────────────────

    def index_handbook(self, pdf_path: Path):
        """Extract, chunk, embed and save the handbook index."""
        logger.info(f"Indexing Faculty Handbook: {pdf_path}")
        try:
            text = self._extract_pdf_text(pdf_path)
        except Exception as exc:
            logger.error(f"Failed to extract PDF text: {exc}")
            return

        chunks = self._chunk_text(text)
        if not chunks:
            logger.warning("No text extracted from handbook PDF")
            return

        texts = [c["text"] for c in chunks]
        try:
            embeddings = self._embed(texts)
        except Exception as exc:
            logger.error(f"Handbook embedding failed: {exc}")
            return

        self._index = [
            {"chunk_id": i, "text": c["text"], "page": c["page"]}
            for i, c in enumerate(chunks)
        ]
        self._embeddings = embeddings
        self._save_index()

        # Save meta (hash) so we can detect changes
        HANDBOOK_META_FILE.write_text(
            json.dumps({"pdf_hash": self._pdf_hash(pdf_path), "chunks": len(chunks)}),
            encoding="utf-8",
        )
        logger.info(f"✓ Handbook indexed: {len(chunks)} chunks from {pdf_path.name}")

    def search(self, query: str, top_k: int = 6) -> List[dict]:
        """Return top-k relevant handbook chunks for a query."""
        if not self._index or self._embeddings is None:
            return []
        try:
            q_emb = self._embed([query])[0]
        except Exception as exc:
            logger.error(f"Handbook query embedding failed: {exc}")
            return []

        scores = self._embeddings @ q_emb
        top_indices = np.argsort(scores)[::-1][:top_k]
        results = []
        for i in top_indices:
            if float(scores[i]) >= MIN_SCORE:
                results.append({**self._index[i], "score": float(scores[i])})
        return results


# Singleton
handbook_rag = HandbookRAG()
