"""FastAPI application entry point."""
import sys
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import settings
from app.models.schemas import HealthResponse
from app.modules.pipeline import pipeline_manager
from app.api.routes import meeting, transcript, speaker, export as export_router, analytics, chat


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logger.remove()
logger.add(
    sys.stdout,
    level=settings.LOG_LEVEL,
    format="<green>{time:HH:mm:ss}</green> | <level>{level:<8}</level> | <cyan>{name}</cyan> – {message}",
    colorize=True,
)
logger.add(
    settings.DATA_DIR / "server.log",
    level="DEBUG",
    rotation="50 MB",
    retention="30 days",
    encoding="utf-8",
)


# ─────────────────────────────────────────────────────────────────────────────
# Startup / Shutdown
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} v{settings.VERSION}")
    await pipeline_manager.load_models()
    _fix_completed_statuses()
    logger.info("Server ready")
    yield
    logger.info("Shutting down")


def _fix_completed_statuses():
    """One-time migration: mark meetings as 'completed' if a MoM file exists but meta still says 'stopped'."""
    import json
    fixed = 0
    for meta_path in settings.MEETINGS_DIR.glob("*_meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("status") == "stopped":
                mid = meta.get("meeting_id", meta_path.stem.replace("_meta", ""))
                mom_path = settings.MEETINGS_DIR / f"{mid}_mom.json"
                if mom_path.exists():
                    meta["status"] = "completed"
                    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
                    fixed += 1
        except Exception:
            pass
    if fixed:
        logger.info(f"Migration: marked {fixed} meeting(s) as completed")


# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=(
        "Offline AI-powered Faculty Meeting Minutes of Meeting (MoM) Assistant. "
        "Supports Urdu + English speech, speaker diarization, and professional MoM export."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(meeting.router)
app.include_router(transcript.router)
app.include_router(speaker.router)
app.include_router(export_router.router)
app.include_router(analytics.router)
app.include_router(chat.router)


# ─────────────────────────────────────────────────────────────────────────────
# Health endpoint
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
        ollama_ok = r.status_code == 200
    except Exception:
        pass

    return HealthResponse(
        status="ok" if pipeline_manager.models_loaded else "initialising",
        version=settings.VERSION,
        models_loaded=pipeline_manager.models_loaded,
        ollama_ready=ollama_ok,
        active_meetings=len([
            s for s in pipeline_manager._sessions.values()
            if s.status.value == "recording"
        ]),
    )


@app.get("/", tags=["System"])
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.VERSION,
        "docs": "/docs",
        "health": "/health",
    }
