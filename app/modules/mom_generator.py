"""MoM document assembly.

Takes raw LLM JSON output and produces a validated MoMDocument.
"""
from datetime import datetime
from typing import Optional
from loguru import logger
from app.models.schemas import (
    MoMDocument, ActionItem, DiscussionPoint, Decision
)


class MoMGenerator:
    """Convert LLM JSON dict → validated MoMDocument."""

    def build(self, meeting_id: str, llm_data: dict, fallback_venue: str = "") -> MoMDocument:
        now = datetime.now()

        action_items = [
            ActionItem(
                item=a.get("item", ""),
                responsible=a.get("responsible", "TBD"),
                deadline=a.get("deadline", "TBD"),
            )
            for a in llm_data.get("action_items", [])
            if a.get("item")
        ]

        discussion_summary = [
            DiscussionPoint(
                topic=d.get("topic", ""),
                summary=d.get("summary", ""),
                speaker=d.get("speaker"),
            )
            for d in llm_data.get("discussion_summary", [])
            if d.get("topic")
        ]

        decisions = [
            Decision(
                decision=d.get("decision", ""),
                made_by=d.get("made_by"),
            )
            for d in llm_data.get("decisions", [])
            if d.get("decision")
        ]

        return MoMDocument(
            meeting_id=meeting_id,
            meeting_title=llm_data.get("meeting_title", "Faculty Meeting"),
            date=llm_data.get("date", now.strftime("%d %B %Y")),
            time=llm_data.get("time", now.strftime("%I:%M %p")),
            venue=llm_data.get("venue") or fallback_venue,
            chaired_by=llm_data.get("chaired_by", "Not mentioned"),
            attendees=llm_data.get("attendees", []),
            agenda_items=llm_data.get("agenda_items", []),
            discussion_summary=discussion_summary,
            decisions=decisions,
            action_items=action_items,
            next_meeting=llm_data.get("next_meeting", "TBD"),
            closing_remarks=llm_data.get("closing_remarks", ""),
            additional_notes=llm_data.get("additional_notes", ""),
            generated_at=now,
        )
