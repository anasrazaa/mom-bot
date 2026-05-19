"""Handbook chat routes: RAG-based Q&A over the Faculty Handbook PDF."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.modules.handbook_rag import handbook_rag
from app.modules.pipeline import pipeline_manager

router = APIRouter(prefix="/handbook", tags=["Handbook"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class HandbookChatMessage(BaseModel):
    role: str       # "user" | "assistant"
    content: str

class HandbookChatRequest(BaseModel):
    question: str
    history: Optional[List[HandbookChatMessage]] = None

class HandbookChatResponse(BaseModel):
    answer: str
    sources: List[dict]   # [{text, page, score}]

class HandbookStatusResponse(BaseModel):
    indexed: bool
    chunks: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=HandbookChatResponse, summary="Ask a question about faculty policies")
async def handbook_chat(req: HandbookChatRequest):
    chunks = handbook_rag.search(req.question, top_k=6)
    history = [m.model_dump() for m in req.history] if req.history else None
    try:
        answer = await pipeline_manager._llm.chat_handbook(req.question, chunks, history)
    except Exception as exc:
        raise HTTPException(500, detail=f"LLM error: {exc}")
    return HandbookChatResponse(answer=answer, sources=chunks)


@router.get("/status", response_model=HandbookStatusResponse, summary="Check handbook index status")
async def handbook_status():
    indexed = bool(handbook_rag._index)
    return HandbookStatusResponse(indexed=indexed, chunks=len(handbook_rag._index))
