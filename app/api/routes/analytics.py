"""Speaker participation analytics routes."""
import json
import math
from typing import List

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.config import settings
from app.models.schemas import (
    MeetingAnalytics, CrossMeetingAnalytics, SpeakerStat, TimelineSegment,
)
from app.modules.pipeline import pipeline_manager
from app.modules.transcript_manager import TranscriptManager

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _equity_score(speaking_times: List[float]) -> float:
    """1 - Gini coefficient.  1.0 = perfectly balanced, 0.0 = one person speaks."""
    n = len(speaking_times)
    if n <= 1:
        return 1.0
    total = sum(speaking_times)
    if total == 0:
        return 1.0
    gini_sum = sum(abs(a - b) for a in speaking_times for b in speaking_times)
    return round(max(0.0, 1.0 - gini_sum / (2 * n * total)), 2)


def _compute_analytics(meeting_id: str, title: str, date: str, entries) -> MeetingAnalytics:
    entries_list = list(entries)

    speaker_map: dict = {}
    total_words = 0
    actual_duration = max((e.end_time for e in entries_list), default=0.0)

    for entry in entries_list:
        spk = entry.speaker or "Unknown"
        duration = max(0.0, entry.end_time - entry.start_time)
        words = len((entry.text or "").split())

        if spk not in speaker_map:
            speaker_map[spk] = {"time": 0.0, "words": 0, "segments": 0}
        speaker_map[spk]["time"]     += duration
        speaker_map[spk]["words"]    += words
        speaker_map[spk]["segments"] += 1
        total_words += words

    total_speaking_time = sum(s["time"] for s in speaker_map.values())
    silence_pct = round(
        max(0.0, (actual_duration - total_speaking_time) / actual_duration * 100), 1
    ) if actual_duration > 0 else 0.0

    equity = _equity_score([s["time"] for s in speaker_map.values()])

    speakers: List[SpeakerStat] = []
    for spk, s in sorted(speaker_map.items(), key=lambda x: -x[1]["time"]):
        wpm = round((s["words"] / s["time"]) * 60, 1) if s["time"] > 0 else 0.0
        avg_turn = round(s["time"] / s["segments"], 1) if s["segments"] > 0 else 0.0
        speakers.append(SpeakerStat(
            speaker=spk,
            speaking_time_sec=round(s["time"], 1),
            word_count=s["words"],
            segment_count=s["segments"],
            pct_time=round(s["time"] / total_speaking_time * 100, 1) if total_speaking_time > 0 else 0.0,
            pct_words=round(s["words"] / total_words * 100, 1) if total_words > 0 else 0.0,
            speaking_rate_wpm=wpm,
            avg_turn_duration=avg_turn,
        ))

    timeline = [
        TimelineSegment(
            speaker=e.speaker or "Unknown",
            start_time=round(e.start_time, 2),
            end_time=round(e.end_time, 2),
        )
        for e in entries_list
    ]

    return MeetingAnalytics(
        meeting_id=meeting_id,
        title=title,
        date=date,
        speakers=speakers,
        total_duration_sec=round(actual_duration, 1),
        total_words=total_words,
        total_segments=len(entries_list),
        silence_pct=silence_pct,
        equity_score=equity,
        timeline=timeline,
    )


@router.get("/meeting/{meeting_id}", response_model=MeetingAnalytics)
async def meeting_analytics(meeting_id: str):
    session = pipeline_manager.get_session(meeting_id)
    if session:
        entries = session.transcript.entries
        title = session.title
        date = session.start_time.strftime("%d %b %Y")
    else:
        meta_path = settings.MEETINGS_DIR / f"{meeting_id}_meta.json"
        if not meta_path.exists():
            raise HTTPException(404, detail="Meeting not found")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        title = meta.get("title", "Unknown")
        date = meta.get("start_time", "")[:10]
        entries = TranscriptManager(meeting_id).entries

    if not entries:
        raise HTTPException(400, detail="No transcript data available for this meeting")

    return _compute_analytics(meeting_id, title, date, entries)


@router.get("/cross-meeting", response_model=CrossMeetingAnalytics)
async def cross_meeting_analytics():
    all_meetings = pipeline_manager.list_meetings()
    results: List[MeetingAnalytics] = []
    all_speakers: set = set()

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
