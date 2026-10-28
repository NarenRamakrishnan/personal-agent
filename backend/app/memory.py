"""What Heedly remembers about the person, and reminders that repeat (Module 11).

The model notices facts the person states about their own life in the same call that
reads their reminders: who someone is ("my mom Priya, her email is ...") and where they
usually do an errand ("I always get groceries at Trader Joe's"). Those facts come back
in later prompts, so "buy milk" lands at their store and "email Mom" has an address.

The model's word is never enough on its own. An email address or a store name is kept
only if the person actually said it in that text, the same rule the email drafter uses,
so overheard speech or a confused reply can't plant a recipient or a place.
"""

import calendar
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app import emailer, places
from app.models import MemoryRow, ReminderRow, utcnow

log = logging.getLogger(__name__)

# How many facts the model is shown. Each costs prompt tokens on every chunk.
MAX_IN_PROMPT = 20
MAX_PER_REPLY = 5
LABEL_MAX, PLACE_MAX = 60, 100


@dataclass
class Learned:
    """A fact the model heard, already checked against the words."""

    kind: str  # person | place
    key: str
    label: str
    alias: str | None = None
    email: str | None = None
    place_name: str | None = None
    place_type: str | None = None


def key_for(label: str) -> str:
    """"My Mom" and "mom" are the same person; "the groceries" and "groceries" the same errand."""
    words = re.sub(r"[^\w\s'-]", " ", label.lower()).split()
    while words and words[0] in ("my", "the", "our", "a", "an"):
        words = words[1:]
    return " ".join(words)[:LABEL_MAX]


def _clean(value, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip(" .,'\"")
    return value[:limit] or None


def _said(phrase: str, text: str) -> bool:
    """The phrase appears in what the person said, ignoring case and punctuation."""
    squash = lambda s: re.sub(r"[^\w]+", " ", s.lower()).strip()  # noqa: E731
    return f" {squash(phrase)} " in f" {squash(text)} "


def from_model(raw, source_text: str) -> Learned | None:
    """One memory from the model's reply, or None if it isn't usable or wasn't said."""
    if not isinstance(raw, dict):
        return None
    if raw.get("kind") == "person":
        label = _clean(raw.get("name"), LABEL_MAX)
        if not label or not key_for(label) or not _said(key_for(label), source_text):
            return None
        alias = _clean(raw.get("alias"), LABEL_MAX)
        alias = alias if alias and _said(alias, source_text) and key_for(alias) != key_for(label) else None
        email = emailer._spoken_address(raw.get("email"), source_text)
        if not alias and not email:
            return None  # "Mom" with nothing known about her helps nobody
        return Learned("person", key_for(label), label, alias=alias, email=email)
    if raw.get("kind") == "place":
        label = _clean(raw.get("for"), LABEL_MAX)
        place = _clean(raw.get("place"), PLACE_MAX)
        if not label or not place or not key_for(label) or not _said(place, source_text):
            return None
        saved = places.saved_place_name(place)
        if saved in places.SAVED_PLACE_NAMES:
            return Learned("place", key_for(label), label, place_name=saved, place_type="saved_place")
        if places.canonical_category(place):
            return None  # "groceries at a grocery store" teaches nothing a category doesn't
        return Learned("place", key_for(label), label, place_name=place, place_type="place")
    return None


def learned_from_reply(items, source_text: str) -> list[Learned]:
    if not isinstance(items, list):
        return []
    out: dict[tuple[str, str], Learned] = {}
    for raw in items[:MAX_PER_REPLY]:
        fact = from_model(raw, source_text)
        if fact is not None:
            out[(fact.kind, fact.key)] = fact
    return list(out.values())


def remember(db: Session, owner: str, facts: list[Learned], session_id: str | None) -> list[MemoryRow]:
    """Save facts, updating one already known. Doesn't commit: the caller's commit
    lands them together with the reminders from the same words."""
    rows = []
    for fact in facts:
        row = db.exec(select(MemoryRow).where(MemoryRow.owner == owner, MemoryRow.kind == fact.kind,
                                              MemoryRow.key == fact.key)).first()
        if row is None:
            row = MemoryRow(owner=owner, kind=fact.kind, key=fact.key, label=fact.label)
        # Only what was said this time changes; an alias said once isn't lost later.
        row.label = fact.label
        for field in ("alias", "email", "place_name", "place_type"):
            if getattr(fact, field):
                setattr(row, field, getattr(fact, field))
        row.session_id, row.updated_at = session_id, utcnow()
        db.add(row)
        rows.append(row)
    return rows


def known(db: Session, owner: str) -> list[MemoryRow]:
    return list(db.exec(select(MemoryRow).where(MemoryRow.owner == owner)
                        .order_by(MemoryRow.updated_at.desc(), MemoryRow.id).limit(MAX_IN_PROMPT)))


def prompt_lines(rows: list[MemoryRow]) -> list[str]:
    """How the facts are shown to the model. Email addresses never are: it doesn't need them."""
    lines = []
    for row in rows:
        if row.kind == "person":
            also = f' (also called "{row.alias}")' if row.alias else ""
            lines.append(f'- person "{row.label}"{also}' + (", email on file" if row.email else ""))
        elif row.kind == "place" and row.place_name:
            lines.append(f'- "{row.label}": they usually go to "{row.place_name}"'
                         + (" (one of their saved places)" if row.place_type == "saved_place" else ""))
    return lines


def email_for(db: Session, owner: str, to_name: str | None) -> str | None:
    """The address the person taught for someone they named ("Mom", "my sister", "Priya")."""
    if not to_name:
        return None
    key = key_for(to_name)
    for row in db.exec(select(MemoryRow).where(MemoryRow.owner == owner, MemoryRow.kind == "person")):
        if row.email and key in (row.key, key_for(row.alias or "")):
            return row.email
    return None


# Repeating reminders. Completing one makes the next; un-completing takes it back.

def _add_month(dt: datetime) -> datetime:
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return dt.replace(year=year, month=month, day=min(dt.day, calendar.monthrange(year, month)[1]))


def next_time(deadline: datetime, rule: str, now: datetime) -> datetime:
    """The first repeat after now, keeping the time of day ("every Monday at 9")."""
    step = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1)}.get(rule)
    nxt = deadline
    for _ in range(1000):  # a deadline years back still ends
        nxt = nxt + step if step else _add_month(nxt)
        if nxt > now:
            return nxt
    return nxt


def make_next(db: Session, row: ReminderRow, now: datetime | None = None) -> ReminderRow | None:
    """The next one of a repeating reminder that was just completed. Doesn't commit."""
    if not row.repeat or row.deadline is None:
        return None
    already = db.exec(select(ReminderRow).where(ReminderRow.owner == row.owner, ReminderRow.repeat_of == row.id)).first()
    if already is not None:
        return None  # completed, reopened and completed again: one next is enough
    nxt = ReminderRow(owner=row.owner, title=row.title, description=row.description, trigger_type=row.trigger_type,
                      location=row.location, deadline=next_time(row.deadline, row.repeat, now or utcnow()),
                      repeat=row.repeat, repeat_of=row.id)
    db.add(nxt)
    return nxt


def take_back_next(db: Session, row: ReminderRow) -> None:
    """Reopening a repeating reminder removes the next one it made, unless that one is done."""
    for nxt in db.exec(select(ReminderRow).where(ReminderRow.owner == row.owner, ReminderRow.repeat_of == row.id,
                                                 ReminderRow.completed == False)):  # noqa: E712
        db.delete(nxt)
