"""MoM document assembly.

Takes raw LLM JSON output and produces a validated MoMDocument.
"""
from datetime import datetime
from typing import Any
from loguru import logger
from app.models.schemas import (
    MoMDocument, ActionItem, DiscussionPoint, Decision
)


class MoMGenerator:
    """Convert LLM JSON dict → validated MoMDocument."""

    @staticmethod
    def _to_str_list(values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        out = []
        for v in values:
            if isinstance(v, str):
                s = v.strip()
                if s:
                    out.append(s)
            elif isinstance(v, dict):
                # fallback if LLM returns object-like items in a plain list field
                s = str(v.get("item") or v.get("name") or "").strip()
                if s:
                    out.append(s)
        return out

    def build(self, meeting_id: str, llm_data: dict, fallback_venue: str = "") -> MoMDocument:
        now = datetime.now()

        raw_actions = llm_data.get("action_items", [])
        action_items = []
        if isinstance(raw_actions, list):
            for a in raw_actions:
                if isinstance(a, dict):
                    item = str(a.get("item", "")).strip()
                    if not item:
                        continue
                    action_items.append(
                        ActionItem(
                            item=item,
                            responsible=str(a.get("responsible", "TBD") or "TBD"),
                            deadline=str(a.get("deadline", "TBD") or "TBD"),
                        )
                    )
                elif isinstance(a, str):
                    item = a.strip()
                    if item:
                        action_items.append(ActionItem(item=item, responsible="TBD", deadline="TBD"))

        raw_discussion = llm_data.get("discussion_summary")
        if not isinstance(raw_discussion, list):
            # Accept draft-style key if model returns it.
            raw_discussion = llm_data.get("discussion_points", [])
        discussion_summary = []
        if isinstance(raw_discussion, list):
            for d in raw_discussion:
                if isinstance(d, dict):
                    topic = str(d.get("topic", "")).strip()
                    summary = str(d.get("summary", "")).strip()
                    if topic:
                        discussion_summary.append(
                            DiscussionPoint(topic=topic, summary=summary, speaker=d.get("speaker"))
                        )
                elif isinstance(d, str):
                    text = d.strip()
                    if text:
                        discussion_summary.append(DiscussionPoint(topic=text, summary=text, speaker=None))

        raw_decisions = llm_data.get("decisions", [])
        decisions = []
        if isinstance(raw_decisions, list):
            for d in raw_decisions:
                if isinstance(d, dict):
                    decision_text = str(d.get("decision", "")).strip()
                    if decision_text:
                        decisions.append(Decision(decision=decision_text, made_by=d.get("made_by")))
                elif isinstance(d, str):
                    decision_text = d.strip()
                    if decision_text:
                        decisions.append(Decision(decision=decision_text, made_by=None))

        return MoMDocument(
            meeting_id=meeting_id,
            meeting_title=llm_data.get("meeting_title", "Faculty Meeting"),
            date=llm_data.get("date", now.strftime("%d %B %Y")),
            time=llm_data.get("time", now.strftime("%I:%M %p")),
            venue=llm_data.get("venue") or fallback_venue,
            chaired_by=llm_data.get("chaired_by", "Not mentioned"),
            attendees=self._to_str_list(llm_data.get("attendees", [])),
            agenda_items=self._to_str_list(llm_data.get("agenda_items", [])),
            discussion_summary=discussion_summary,
            decisions=decisions,
            action_items=action_items,
            next_meeting=llm_data.get("next_meeting", "TBD"),
            closing_remarks=llm_data.get("closing_remarks", ""),
            additional_notes=llm_data.get("additional_notes", ""),
            generated_at=now,
        )
