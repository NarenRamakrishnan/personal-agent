"""Turns a transcript into candidate reminders (Module 03).

`parse()` is the only entry point. In "nebius" mode it asks Nemotron for
structured JSON; in "mock" mode (no API key yet) it returns a placeholder so the
mobile app can build against /parse.

Because the app listens continuously, most of what it hears is NOT a
commitment. The model is told to return an empty list for those, and an empty
list is a normal, successful result.
"""

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from app import config, llm
from app.models import ReminderCreate

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You extract reminders from what a person said out loud.

Current local time: {now_local} ({weekday}), timezone {tz}.

Return ONLY a JSON object: {{"reminders": [ ... ]}}. Each reminder has:
- "title": short imperative, e.g. "Call Mom". No "remind me to".
- "description": optional extra detail, or null.
- "deadline": ISO 8601 with a UTC offset, e.g. "2026-10-02T17:00:00-04:00", or null if no time was given.
- "triggerType": "time" (only a time), "location" (only a place) or "time_and_location" (both).
- "location": null, or {{"type": "place"|"category"|"saved_place", "name": str|null, "category": str|null}}.
  - "category" for a kind of place: one of grocery_store, pharmacy, gym, restaurant, coffee_shop, university, shopping.
  - "saved_place" for the person's own places ("home", "work", "school"), with "name" set to that word.
  - "place" for one specific named place ("Target"), with "name" set.

Rules:
- If the person says nothing that is a task or commitment (chat, questions, opinions, small talk), return {{"reminders": []}}.
- One reminder per distinct commitment. Split "do A and do B" into two.
- Resolve relative words against the current local time above: "tonight" is today evening (use 20:00 unless a time is given), "tomorrow morning" is 09:00 tomorrow, a bare weekday is its next occurrence, "next Monday" is the Monday of next week.
- If a time is only vague ("sometime", "eventually") leave deadline null. Never invent a time the person did not imply.
- A reminder with a place and no time is triggerType "location" with deadline null.
- Never invent a place. Only fill "location" if a place was said.
"""


def resolve_tz(name: str | None) -> ZoneInfo:
    for candidate in (name, config.DEFAULT_TIMEZONE):
        if candidate:
            try:
                return ZoneInfo(candidate)
            except (ZoneInfoNotFoundError, ValueError):
                # ValueError is what ZoneInfo raises for path-like keys such as
                # "../x" or "/etc/localtime". Don't log the client's string.
                log.warning("unusable timezone ignored")
    return ZoneInfo("UTC")


def build_messages(text: str, now: datetime, tz: ZoneInfo) -> list[dict]:
    local = now.astimezone(tz)
    system = SYSTEM_PROMPT.format(
        now_local=local.strftime("%Y-%m-%d %H:%M"), weekday=local.strftime("%A"), tz=str(tz)
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": text}]


def _coerce(item: dict, tz: ZoneInfo, session_id: str, source_text: str) -> ReminderCreate:
    item = dict(item)
    deadline = item.get("deadline")
    if isinstance(deadline, str) and deadline:
        parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        # The model sometimes drops the offset. Read it in the person's timezone
        # rather than rejecting a reminder we could have saved.
        item["deadline"] = parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)
    else:
        item["deadline"] = None
    location = item.get("location")
    if isinstance(location, dict):
        location = {k: v for k, v in location.items() if v is not None}
        item["location"] = location or None
    # Keep trigger type consistent with what is actually present.
    has_place, has_time = bool(item.get("location")), item["deadline"] is not None
    if has_place and has_time:
        item["triggerType"] = "time_and_location"
    elif has_place:
        item["triggerType"] = "location"
    elif item.get("triggerType") != "time":
        item["triggerType"] = "time"
    item.pop("sessionId", None)
    return ReminderCreate.model_validate(
        {**item, "sessionId": session_id, "sourceText": source_text}
    )


def parse_llm(text: str, now: datetime, tz: ZoneInfo, session_id: str) -> list[ReminderCreate]:
    data = llm.chat_json(build_messages(text, now, tz))
    items = data.get("reminders")
    if not isinstance(items, list):
        raise llm.LLMError("model reply had no 'reminders' list")
    out = []
    for item in items:
        try:
            out.append(_coerce(item, tz, session_id, text))
        except (ValidationError, ValueError, TypeError, AttributeError) as e:
            # One bad item should not lose the rest of the session.
            log.warning("dropped unparseable reminder from model: %s", type(e).__name__)
    return out


def parse_fallback(text: str, session_id: str) -> list[ReminderCreate]:
    """The model failed: keep what the person said instead of losing it.

    The reminder has no deadline, so it lands in the review list for the
    person to fix rather than firing at a wrong time.
    """
    return [
        ReminderCreate(
            title=text.strip()[:80], trigger_type="time", session_id=session_id, source_text=text
        )
    ]


def parse_mock(text: str, now: datetime, session_id: str) -> list[ReminderCreate]:
    return [
        ReminderCreate(
            title=text.strip()[:80],
            trigger_type="time",
            deadline=now + timedelta(hours=1),
            session_id=session_id,
            source_text=text,
        )
    ]


def parse(
    text: str, now: datetime | None, session_id: str, tz_name: str | None = None
) -> list[ReminderCreate]:
    now = now or datetime.now(timezone.utc)
    if config.parser_mode() == "mock":
        return parse_mock(text, now, session_id)
    try:
        return parse_llm(text, now, resolve_tz(tz_name), session_id)
    except llm.LLMError as e:
        log.warning("LLM parse failed, using fallback: %s", e)
        return parse_fallback(text, session_id)
