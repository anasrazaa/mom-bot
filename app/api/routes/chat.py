"""Chat routes: RAG-based Q&A, live summary, and pre-meeting prep brief."""
import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.modules.pipeline import pipeline_manager
from app.modules.rag import rag_module
from app.modules.transcript_manager import TranscriptManager

router = APIRouter(prefix="/chat", tags=["Chat"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    question: str
    history: Optional[List[ChatMessage]] = None
    meeting_id: Optional[str] = None   # scope search to one meeting

class ChatResponse(BaseModel):
    answer: str
    sources: List[dict]  # [{meeting_id, meeting_title, text, score}]

class PrepRequest(BaseModel):
    agenda: List[str]
    meeting_id: Optional[str] = None   # optional: scope context to specific meeting

class IntervalSummary(BaseModel):
    label: str
    overview: str
    decisions: List[str]
    action_items: List[str]

class SummaryResponse(BaseModel):
    meeting_id: str
    intervals: List[IntervalSummary]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/message", response_model=ChatResponse, summary="Ask a question over meeting history")
async def chat_message(req: ChatRequest):
    chunks = rag_module.search(req.question, top_k=6, meeting_id=req.meeting_id)
    history = [m.model_dump() for m in req.history] if req.history else None
    try:
        answer = await pipeline_manager._llm.chat_rag(req.question, chunks, history)
    except Exception as exc:
        raise HTTPException(500, detail=f"LLM error: {exc}")
    return ChatResponse(answer=answer, sources=chunks)


@router.post("/prepare", summary="Generate pre-meeting preparation brief")
async def prepare_brief(req: PrepRequest):
    if not req.agenda:
        raise HTTPException(400, detail="agenda must not be empty")
    # Build a combined query from agenda items for RAG retrieval
    combined_query = " ".join(req.agenda)
    chunks = rag_module.search(combined_query, top_k=8, meeting_id=req.meeting_id)
    try:
        brief = await pipeline_manager._llm.generate_prep_brief(req.agenda, chunks)
    except Exception as exc:
        raise HTTPException(500, detail=f"LLM error: {exc}")
    return brief


@router.get("/summary/{meeting_id}", response_model=SummaryResponse, summary="Get live interval summaries for a meeting")
async def get_summary(meeting_id: str):
    try:
        result = await pipeline_manager.generate_live_summary(meeting_id)
    except KeyError as exc:
        raise HTTPException(404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(500, detail=f"Summary generation failed: {exc}")
    intervals = [
        IntervalSummary(
            label=s.get("label", ""),
            overview=s.get("overview", ""),
            decisions=s.get("decisions", []),
            action_items=s.get("action_items", []),
        )
        for s in result.get("intervals", [])
    ]
    return SummaryResponse(meeting_id=meeting_id, intervals=intervals)


@router.get("/indexed", summary="List meetings indexed for RAG")
async def indexed_meetings():
    return {"meeting_ids": rag_module.indexed_meetings()}
