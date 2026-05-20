"""Live transcript routes and WebSocket push."""
import soundfile as sf
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.models.schemas import TranscriptResponse
from app.modules.pipeline import pipeline_manager
from app.modules.transcript_manager import TranscriptManager

router = APIRouter(prefix="/transcript", tags=["Transcript"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CorrectSpeakerRequest(BaseModel):
    entry_id: str
    new_speaker: str
    enroll: bool = True   # also add the audio clip as a new speaker embedding


@router.get("/{meeting_id}", response_model=TranscriptResponse, summary="Get full transcript")
async def get_transcript(meeting_id: str):
    session = pipeline_manager.get_session(meeting_id)
    if session:
        entries = session.transcript.entries
    else:
        meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
        if not meta_path.exists():
            raise HTTPException(404, detail="Meeting not found")
        entries = TranscriptManager(meeting_id).entries
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


# ── Speaker-correction endpoints ─────────────────────────────────────────────

@router.get("/{meeting_id}/clip/{entry_id}", summary="Stream audio clip for a transcript entry")
async def get_entry_clip(meeting_id: str, entry_id: str):
    """Return the saved WAV audio for one transcript entry (used for speaker correction playback)."""
    clip_path = settings.CLIPS_DIR / meeting_id / f"{entry_id}.wav"
    if not clip_path.exists():
        raise HTTPException(404, detail="Audio clip not available for this entry")
    return FileResponse(str(clip_path), media_type="audio/wav")


@router.post("/{meeting_id}/correct", summary="Correct a speaker label and optionally re-enroll")
async def correct_speaker(meeting_id: str, req: CorrectSpeakerRequest):
    """
    Update the speaker name for one transcript entry.
    If enroll=True and an audio clip exists for this entry, the clip is also added
    to the speaker's voice profile so future meetings recognise them better.
    """
    if not req.new_speaker.strip():
        raise HTTPException(400, detail="new_speaker must not be empty")

    # Update transcript (live session or persisted on disk)
    session = pipeline_manager.get_session(meeting_id)
    if session:
        updated = session.transcript.update_speaker(req.entry_id, req.new_speaker)
    else:
        meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
        if not meta_path.exists():
            raise HTTPException(404, detail="Meeting not found")
        tm = TranscriptManager(meeting_id)
        updated = tm.update_speaker(req.entry_id, req.new_speaker)

    if not updated:
        raise HTTPException(404, detail=f"Entry {req.entry_id} not found in transcript")

    # Optionally re-enroll from the saved audio clip
    enrolled = False
    if req.enroll:
        clip_path = settings.CLIPS_DIR / meeting_id / f"{req.entry_id}.wav"
        if clip_path.exists():
            try:
                import numpy as np
                audio_np, sr = sf.read(str(clip_path), dtype="float32")
                if audio_np.ndim > 1:
                    audio_np = audio_np.mean(axis=1)
                if len(audio_np) >= sr * 1.0:   # need at least 1 second
                    spk_mod = pipeline_manager.speaker_id_module
                    enrolled = spk_mod.enroll(name=req.new_speaker, audio=audio_np, sample_rate=int(sr))
            except Exception as exc:
                logger.warning(f"Re-enrollment from clip failed ({req.entry_id}): {exc}")

    return {
        "status": "ok",
        "entry_id": req.entry_id,
        "new_speaker": req.new_speaker,
        "enrolled": enrolled,
    }

