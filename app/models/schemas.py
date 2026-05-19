from enum import Enum
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class MeetingStatus(str, Enum):
    RECORDING = "recording"
    STOPPED = "stopped"
    PROCESSING = "processing"
    COMPLETED = "completed"


# ─────────────────────────────────────────────────────────────────────────────
# Meeting
# ─────────────────────────────────────────────────────────────────────────────

class UpdateMeetingRequest(BaseModel):
    venue: Optional[str] = None
    chaired_by: Optional[str] = None


class StartMeetingRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200, example="Faculty Senate Meeting – May 2025")
    venue: str = Field(default="Conference Room, Admin Block", max_length=200)
    chaired_by: Optional[str] = Field(default=None, max_length=100)
    attendees: List[str] = Field(default_factory=list)
    agenda: Optional[List[str]] = Field(default=None, description="Optional meeting agenda items")


class MeetingInfo(BaseModel):
    meeting_id: str
    title: str
    venue: str
    chaired_by: Optional[str]
    start_time: datetime
    end_time: Optional[datetime] = None
    status: MeetingStatus
    transcript_count: int = 0
    agenda: Optional[List[str]] = None


class MeetingListResponse(BaseModel):
    meetings: List[MeetingInfo]
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Transcript
# ─────────────────────────────────────────────────────────────────────────────

class TranscriptEntry(BaseModel):
    id: str
    speaker: str
    text: str
    start_time: float     # seconds from meeting start
    end_time: float
    timestamp: datetime
    language: Optional[str] = None  # detected language code
    confidence: Optional[float] = None  # Whisper avg logprob (higher is better)


class TranscriptResponse(BaseModel):
    meeting_id: str
    entries: List[TranscriptEntry]
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Speaker Enrollment
# ─────────────────────────────────────────────────────────────────────────────

class SpeakerEnrollResponse(BaseModel):
    name: str
    status: str
    message: str
    sample_count: int = 0


class SpeakerListResponse(BaseModel):
    speakers: List[str]
    sample_counts: Dict[str, int] = Field(default_factory=dict)
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Minutes of Meeting (MoM)
# ─────────────────────────────────────────────────────────────────────────────

class ActionItem(BaseModel):
    item: str
    responsible: str
    deadline: str = "TBD"


class DiscussionPoint(BaseModel):
    topic: str
    summary: str
    speaker: Optional[str] = None


class Decision(BaseModel):
    decision: str
    made_by: Optional[str] = None


class MoMDocument(BaseModel):
    meeting_id: str
    meeting_title: str
    date: str
    time: str
    venue: str
    chaired_by: str = "Unknown"
    attendees: List[str] = Field(default_factory=list)
    agenda_items: List[str] = Field(default_factory=list)
    discussion_summary: List[DiscussionPoint] = Field(default_factory=list)
    decisions: List[Decision] = Field(default_factory=list)
    action_items: List[ActionItem] = Field(default_factory=list)
    next_meeting: str = "TBD"
    closing_remarks: str = ""
    additional_notes: str = ""
    conclusion: str = ""
    generated_at: datetime = Field(default_factory=datetime.now)


class GenerateMoMRequest(BaseModel):
    meeting_id: str
    additional_context: Optional[str] = None
    draft_points: Optional[Dict[str, Any]] = None


class GenerateMoMResponse(BaseModel):
    meeting_id: str
    status: str
    mom: Optional[MoMDocument] = None
    message: str = ""


class MoMDraftDiscussionPoint(BaseModel):
    topic: str
    summary: str
    speaker: Optional[str] = None


class MoMDraftActionItem(BaseModel):
    item: str
    responsible: str = "TBD"
    deadline: str = "TBD"


class MoMDraftPoints(BaseModel):
    meeting_title: str = ""
    chaired_by: str = "Not mentioned"
    attendees: List[str] = Field(default_factory=list)
    agenda_items: List[str] = Field(default_factory=list)
    discussion_points: List[MoMDraftDiscussionPoint] = Field(default_factory=list)
    decisions: List[str] = Field(default_factory=list)
    action_items: List[MoMDraftActionItem] = Field(default_factory=list)
    closing_remarks: str = ""
    additional_notes: str = ""


class GenerateMoMDraftRequest(BaseModel):
    meeting_id: str
    additional_context: Optional[str] = None


class GenerateMoMDraftResponse(BaseModel):
    meeting_id: str
    status: str
    draft_points: MoMDraftPoints
    low_confidence_entries: List[TranscriptEntry] = Field(default_factory=list)
    message: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Live Action Items (detected in real-time during recording)
# ─────────────────────────────────────────────────────────────────────────────

class LiveActionItem(BaseModel):
    id: str
    meeting_id: str
    speaker: str
    original_text: str
    action_text: str
    assignee: Optional[str] = None
    deadline: Optional[str] = None
    detected_at: float   # seconds from meeting start
    completed: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ActionItemsResponse(BaseModel):
    meeting_id: str
    items: List[LiveActionItem]
    total: int


class ToggleActionItemRequest(BaseModel):
    completed: bool


# ─────────────────────────────────────────────────────────────────────────────
# Analytics
# ─────────────────────────────────────────────────────────────────────────────

class TimelineSegment(BaseModel):
    speaker: str
    start_time: float
    end_time: float


class SpeakerStat(BaseModel):
    speaker: str
    speaking_time_sec: float
    word_count: int
    segment_count: int
    pct_time: float
    pct_words: float
    speaking_rate_wpm: float = 0.0
    avg_turn_duration: float = 0.0


class MeetingAnalytics(BaseModel):
    meeting_id: str
    title: str
    date: str
    speakers: List[SpeakerStat]
    total_duration_sec: float
    total_words: int
    total_segments: int
    silence_pct: float = 0.0
    equity_score: float = 1.0
    timeline: List[TimelineSegment] = Field(default_factory=list)


class CrossMeetingAnalytics(BaseModel):
    meetings: List[MeetingAnalytics]
    all_speakers: List[str]


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket messages
# ─────────────────────────────────────────────────────────────────────────────

class WSMessage(BaseModel):
    type: str          # "transcript" | "action_item" | "status" | "error"
    data: Dict[str, Any]


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    models_loaded: bool
    ollama_ready: bool
    active_meetings: int
