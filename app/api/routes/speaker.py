"""Speaker enrollment and management routes."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from loguru import logger

from app.models.schemas import SpeakerEnrollResponse, SpeakerListResponse
from app.modules.pipeline import pipeline_manager
from app.utils.helpers import audio_file_to_numpy

router = APIRouter(prefix="/speaker", tags=["Speaker"])


@router.post("/enroll", response_model=SpeakerEnrollResponse, summary="Enroll a voice sample for a speaker")
async def enroll_speaker(
    name: str = Form(..., description="Faculty member's full name"),
    audio: UploadFile = File(..., description="Voice sample (WAV/MP3/WebM, ≥5 seconds)"),
):
    """
    Add one voice sample for a speaker. Call 3–5 times with different samples for
    best identification accuracy. Each call appends a new embedding to the speaker's
    profile (up to 5 stored; oldest are dropped when the limit is exceeded).
    """
    spk_mod = pipeline_manager.speaker_id_module

    raw = await audio.read()
    try:
        audio_np = audio_file_to_numpy(raw, target_sr=16000)
    except ValueError as e:
        raise HTTPException(400, detail=f"Audio decode error: {e}")

    if len(audio_np) < 16000 * 2:
        raise HTTPException(400, detail="Audio sample too short – provide at least 2 seconds")

    success = spk_mod.enroll(name=name, audio=audio_np, sample_rate=16000)
    if success:
        count = spk_mod.sample_count(name)
        return SpeakerEnrollResponse(
            name=name,
            status="enrolled",
            message=f"Sample {count} added for '{name}'",
            sample_count=count,
        )
    else:
        raise HTTPException(500, detail="Enrollment failed – check server logs")


@router.delete("/{name}", response_model=SpeakerEnrollResponse, summary="Remove enrolled speaker")
async def delete_speaker(name: str):
    spk_mod = pipeline_manager.speaker_id_module
    removed = spk_mod.delete(name)
    if removed:
        return SpeakerEnrollResponse(
            name=name, status="deleted", message=f"Speaker '{name}' removed"
        )
    raise HTTPException(404, detail=f"Speaker '{name}' not found")


@router.get("/", response_model=SpeakerListResponse, summary="List enrolled speakers")
async def list_speakers():
    spk_mod = pipeline_manager.speaker_id_module
    speakers = spk_mod.list_speakers()
    counts = spk_mod.speaker_sample_counts()
    return SpeakerListResponse(speakers=speakers, sample_counts=counts, total=len(speakers))
