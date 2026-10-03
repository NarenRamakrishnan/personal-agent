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

from app import config, llm, places
from app.models import ReminderCreate

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You extract reminders from what a person said out loud.

Current local time: {now_local} ({weekday}), timezone {tz}.

Calendar for the next two weeks (use it for every weekday and relative-day; do not work dates out yourself):
{calendar}

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
- A day with no time ("tomorrow", "Friday", "on Monday", "next week") is 09:00 that day.
- Parts of a day: morning 09:00, afternoon 15:00, evening 18:00, tonight or night 20:00.
- If a time is only vague ("sometime", "eventually") leave deadline null. Never invent a time the person did not imply.
- A reminder with a place and no time is triggerType "location" with deadline null.
- Never invent a place. Only fill "location" if a place was said.
- Only add a location when the person wants to be reminded when they are at, near, arriving at or leaving a place ("when I'm at the gym", "at the pharmacy", "near Target", "when I get home"). Merely going somewhere is the task and not a trigger: "go to the gym tomorrow at 9" is a time reminder with no location.
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


def calendar_lines(local: datetime, days: int = 15) -> str:
    """Two weeks of dates with each day's UTC offset, so a deadline past a clock
    change gets the right offset in the first place."""
    names = {0: " (today)", 1: " (tomorrow)"}
    lines = []
    for i in range(days):
        day = (local + timedelta(days=i)).date()
        noon = datetime(day.year, day.month, day.day, 12, tzinfo=local.tzinfo)
        offset = noon.strftime("%z")
        lines.append(f"{day:%a %Y-%m-%d}{names.get(i, '')}, offset {offset[:3]}:{offset[3:]}")
    return "\n".join(lines)


def build_messages(text: str, now: datetime, tz: ZoneInfo) -> list[dict]:
    local = now.astimezone(tz)
    system = SYSTEM_PROMPT.format(
        now_local=local.strftime("%Y-%m-%d %H:%M"),
        weekday=local.strftime("%A"),
        tz=str(tz),
        calendar=calendar_lines(local),
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": text}]


def _canonical_place(loc: dict) -> dict:
    """Make the model's place labels consistent. It sometimes calls a kind of place
    a named place ("the shopping mall" as type place), which would then only match a
    store literally named that. A known category word becomes the category, and
    category labels are folded to our taxonomy ("supermarket" -> grocery_store)."""
    kind = loc.get("type")
    if kind == "category":
        canon = places.canonical_category(loc.get("category") or loc.get("name"))
        if canon:
            return {"type": "category", "category": canon}
    elif kind == "place":
        canon = places.canonical_category(loc.get("name"))
        if canon:
            return {"type": "category", "category": canon}
    return loc


def _fix_clock_change(dt: datetime, tz: ZoneInfo) -> datetime:
    """The model tends to copy today's UTC offset onto every date. Across a clock
    change ("Monday at 9" when Sunday ends daylight saving) that shifts the time by
    an hour. If the offset is one this zone uses but not the right one for that
    date, the person meant the wall-clock time: re-read it in their zone."""
    year = dt.year
    zone_offsets = {tz.utcoffset(datetime(year, 1, 15)), tz.utcoffset(datetime(year, 7, 15))}
    wall = dt.replace(tzinfo=None)
    if dt.utcoffset() in zone_offsets and dt.utcoffset() != tz.utcoffset(wall):
        return wall.replace(tzinfo=tz)
    return dt


# Only these model-supplied fields are trusted. id, createdAt, completed and the
# rest come from the server, so a bad or injected reply can't set them.
MODEL_FIELDS = ("title", "description", "deadline", "triggerType", "location")


def _coerce(raw: dict, tz: ZoneInfo, session_id: str, source_text: str) -> ReminderCreate:
    item = {k: raw[k] for k in MODEL_FIELDS if k in raw}
    deadline = item.get("deadline")
    if isinstance(deadline, str) and deadline:
        parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        # The model sometimes drops the offset. Read it in the person's timezone
        # rather than rejecting a reminder we could have saved.
        item["deadline"] = parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)
        item["deadline"] = _fix_clock_change(item["deadline"], tz)
    else:
        item["deadline"] = None
    location = item.get("location")
    if isinstance(location, dict):
        location = {k: v for k, v in location.items() if v is not None}
        location = _canonical_place(location)
        item["location"] = location or None
    # Keep trigger type consistent with what is actually present.
    has_place, has_time = bool(item.get("location")), item["deadline"] is not None
    if has_place and has_time:
        item["triggerType"] = "time_and_location"
    elif has_place:
        item["triggerType"] = "location"
    elif item.get("triggerType") != "time":
        item["triggerType"] = "time"
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
    text: str,
    now: datetime | None,
    session_id: str,
    tz_name: str | None = None,
    fallback: bool = True,
) -> list[ReminderCreate]:
    """Parse text into candidate reminders.

    fallback=True (typed input): if the model fails, keep what the person typed
    as a reminder for them to fix. fallback=False (always-listening chunks):
    re-raise, because most chunks are chatter and a fallback would turn every
    one of them into a junk reminder.
    """
    now = now or datetime.now(timezone.utc)
    if config.parser_mode() == "mock":
        return parse_mock(text, now, session_id)
    try:
        return parse_llm(text, now, resolve_tz(tz_name), session_id)
    except llm.LLMError as e:
        log.warning("LLM parse failed: %s", e)
        if not fallback:
            raise
        return parse_fallback(text, session_id)
