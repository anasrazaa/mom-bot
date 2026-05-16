"""Meeting lifecycle routes."""
import io
import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from loguru import logger

from app.models.schemas import (
    StartMeetingRequest, UpdateMeetingRequest, MeetingInfo, MeetingListResponse,
    GenerateMoMRequest, GenerateMoMResponse, MeetingStatus,
)
from app.modules.pipeline import pipeline_manager
from app.utils.helpers import audio_file_to_numpy, bytes_to_numpy

router = APIRouter(prefix="/meeting", tags=["Meeting"])


@router.post("/start", response_model=MeetingInfo, summary="Start a new meeting recording")
async def start_meeting(req: StartMeetingRequest):
    try:
        meeting_id = pipeline_manager.create_meeting(
            title=req.title,
            venue=req.venue,
            chaired_by=req.chaired_by,
        )
        session = pipeline_manager.get_session(meeting_id)
        return session.get_info()
    except RuntimeError as e:
        raise HTTPException(503, detail=str(e))


@router.patch("/{meeting_id}", response_model=MeetingInfo, summary="Update venue / chaired-by while recording")
async def update_meeting(meeting_id: str, req: UpdateMeetingRequest):
    try:
        return pipeline_manager.update_meeting(meeting_id, req.venue, req.chaired_by)
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.post("/{meeting_id}/stop", response_model=MeetingInfo, summary="Stop meeting recording")
async def stop_meeting(meeting_id: str):
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        raise HTTPException(404, detail="Meeting not found")
    await pipeline_manager.stop_meeting(meeting_id)
    return session.get_info()


@router.post("/{meeting_id}/upload_audio", summary="Upload a pre-recorded audio file for processing")
async def upload_audio(meeting_id: str, file: UploadFile = File(...)):
    """Accept a WAV/MP3/FLAC/OGG file and run it through the full pipeline."""
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        raise HTTPException(404, detail="Meeting not found")
    if session.status != MeetingStatus.RECORDING:
        raise HTTPException(400, detail="Meeting is not in recording state")

    raw = await file.read()
    try:
        audio = audio_file_to_numpy(raw, target_sr=16000)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))

    # Process in chunks to avoid OOM on large files
    chunk_samples = int(settings_chunk() * 16000)
    for i in range(0, len(audio), chunk_samples):
        chunk = audio[i : i + chunk_samples]
        await session.ingest(chunk, 16000)

    return {"status": "uploaded", "duration_sec": round(len(audio) / 16000, 1)}


@router.post("/generate_mom", response_model=GenerateMoMResponse, summary="Generate MoM from transcript")
async def generate_mom(req: GenerateMoMRequest):
    try:
        mom = await pipeline_manager.generate_mom(
            meeting_id=req.meeting_id,
            additional_context=req.additional_context,
        )
        return GenerateMoMResponse(
            meeting_id=req.meeting_id,
            status="completed",
            mom=mom,
        )
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        logger.error(f"MoM generation failed: {e}", exc_info=True)
        raise HTTPException(500, detail=f"LLM processing failed: {e}")


@router.get("/history", response_model=MeetingListResponse, summary="List all meetings")
async def meeting_history():
    meetings = pipeline_manager.list_meetings()
    return MeetingListResponse(meetings=meetings, total=len(meetings))


@router.get("/{meeting_id}", response_model=MeetingInfo, summary="Get meeting details")
async def get_meeting(meeting_id: str):
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        raise HTTPException(404, detail="Meeting not found")
    return session.get_info()


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket: stream raw audio TO the server
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/ws/audio/{meeting_id}")
async def ws_audio(websocket: WebSocket, meeting_id: str):
    """
    Client streams raw PCM audio frames (int16 LE, 16 kHz, mono).
    Server processes each frame through the pipeline.
    """
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        await websocket.close(code=4004, reason="Meeting not found")
        return

    await websocket.accept()
    logger.info(f"Audio WS connected for meeting {meeting_id}")

    try:
        while True:
            raw = await websocket.receive_bytes()
            audio = bytes_to_numpy(raw)
            await session.ingest(audio, 16000)
    except WebSocketDisconnect:
        logger.info(f"Audio WS disconnected for meeting {meeting_id}")


def settings_chunk():
    from app.config import settings
    return settings.CHUNK_DURATION
