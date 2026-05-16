from enum import Enum
from datetime import datetime
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


class MeetingInfo(BaseModel):
    meeting_id: str
    title: str
    venue: str
    chaired_by: Optional[str]
    start_time: datetime
    end_time: Optional[datetime] = None
    status: MeetingStatus
    transcript_count: int = 0


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
    generated_at: datetime = Field(default_factory=datetime.now)


class GenerateMoMRequest(BaseModel):
    meeting_id: str
    additional_context: Optional[str] = None   # e.g., "This was a budget review meeting"


class GenerateMoMResponse(BaseModel):
    meeting_id: str
    status: str
    mom: Optional[MoMDocument] = None
    message: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket messages
# ─────────────────────────────────────────────────────────────────────────────

class WSMessage(BaseModel):
    type: str          # "transcript" | "status" | "error"
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
