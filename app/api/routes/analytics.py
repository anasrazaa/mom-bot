"""Speaker participation analytics routes."""
import json
from typing import List

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.config import settings
from app.models.schemas import MeetingAnalytics, CrossMeetingAnalytics, SpeakerStat
from app.modules.pipeline import pipeline_manager
from app.modules.transcript_manager import TranscriptManager

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _compute_analytics(meeting_id: str, title: str, date: str, entries) -> MeetingAnalytics:
    """Compute speaker participation stats from a list of TranscriptEntry."""
    speaker_map: dict = {}
    total_duration = 0.0
    total_words = 0

    for entry in entries:
        spk = entry.speaker or "Unknown"
        duration = max(0.0, entry.end_time - entry.start_time)
        words = len((entry.text or "").split())

        if spk not in speaker_map:
            speaker_map[spk] = {"time": 0.0, "words": 0, "segments": 0}
        speaker_map[spk]["time"]     += duration
        speaker_map[spk]["words"]    += words
        speaker_map[spk]["segments"] += 1
        total_duration += duration
        total_words    += words

    speakers: List[SpeakerStat] = []
    for spk, s in sorted(speaker_map.items(), key=lambda x: -x[1]["time"]):
        speakers.append(SpeakerStat(
            speaker=spk,
            speaking_time_sec=round(s["time"], 1),
            word_count=s["words"],
            segment_count=s["segments"],
            pct_time=round(s["time"] / total_duration * 100, 1) if total_duration > 0 else 0.0,
            pct_words=round(s["words"] / total_words * 100, 1) if total_words > 0 else 0.0,
        ))

    return MeetingAnalytics(
        meeting_id=meeting_id,
        title=title,
        date=date,
        speakers=speakers,
        total_duration_sec=round(total_duration, 1),
        total_words=total_words,
        total_segments=len(list(entries)) if not hasattr(entries, '__len__') else len(entries),
    )


@router.get("/meeting/{meeting_id}", response_model=MeetingAnalytics)
async def meeting_analytics(meeting_id: str):
    """Per-meeting speaker participation statistics."""
    session = pipeline_manager.get_session(meeting_id)
    if session:
        entries = session.transcript.entries
        title = session.title
        date = session.start_time.strftime("%d %b %Y")
    else:
        # Load from disk for historical meetings
        meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
        if not meta_path.exists():
            raise HTTPException(404, detail="Meeting not found")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        title = meta.get("title", "Unknown")
        date = meta.get("start_time", "")[:10]
        tm = TranscriptManager(meeting_id)
        entries = tm.entries

    if not entries:
        raise HTTPException(400, detail="No transcript data available for this meeting")

    return _compute_analytics(meeting_id, title, date, entries)


@router.get("/cross-meeting", response_model=CrossMeetingAnalytics)
async def cross_meeting_analytics():
    """Aggregate speaker participation across all meetings with transcripts."""
    all_meetings = pipeline_manager.list_meetings()
    results: List[MeetingAnalytics] = []
    all_speakers = set()

    for info in all_meetings:
        mid = info.meeting_id
        try:
            session = pipeline_manager.get_session(mid)
            entries = session.transcript.entries if session else TranscriptManager(mid).entries
            if not entries:
                continue
            ma = _compute_analytics(
                mid,
                info.title,
                info.start_time.strftime("%d %b %Y"),
                entries,
            )
            results.append(ma)
            for s in ma.speakers:
                all_speakers.add(s.speaker)
        except Exception as exc:
            logger.debug(f"Skipping analytics for {mid}: {exc}")

    results.sort(key=lambda m: m.date)
    return CrossMeetingAnalytics(meetings=results, all_speakers=sorted(all_speakers))
