"""Live transcript routes and WebSocket push."""
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from loguru import logger

from app.models.schemas import TranscriptResponse
from app.modules.pipeline import pipeline_manager

router = APIRouter(prefix="/transcript", tags=["Transcript"])


@router.get("/{meeting_id}", response_model=TranscriptResponse, summary="Get full transcript")
async def get_transcript(meeting_id: str):
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        raise HTTPException(404, detail="Meeting not found")
    entries = session.transcript.entries
    return TranscriptResponse(
        meeting_id=meeting_id,
        entries=entries,
        total=len(entries),
    )


@router.websocket("/ws/{meeting_id}")
async def ws_transcript(websocket: WebSocket, meeting_id: str):
    """
    Push live transcript entries to this WebSocket as they are produced.
    Each message is a JSON object:
      {"type": "transcript", "data": <TranscriptEntry>}
    """
    session = pipeline_manager.get_session(meeting_id)
    if not session:
        await websocket.close(code=4004, reason="Meeting not found")
        return

    await websocket.accept()
    session.ws_clients.add(websocket)
    logger.info(f"Transcript WS connected  meeting={meeting_id}  clients={len(session.ws_clients)}")

    # Send existing transcript on connect
    for entry in session.transcript.entries:
        try:
            await websocket.send_json(
                {"type": "transcript", "data": entry.model_dump(mode="json")}
            )
        except Exception:
            break

    try:
        while True:
            # Keep connection alive; the pipeline pushes to ws_clients
            await websocket.receive_text()
    except WebSocketDisconnect:
        session.ws_clients.discard(websocket)
        logger.info(f"Transcript WS disconnected  meeting={meeting_id}")
