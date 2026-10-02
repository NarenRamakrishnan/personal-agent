"""Listening-session lifecycle (Module 04).

Expiry is lazy: nothing runs in the background. Every read or write first calls
`refresh()`, which ends a session whose silence or total time has run out. That
keeps the backend stateless between requests and easy to restart.
"""

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app import config
from app.models import (
    ActionRow,
    PendingChunkRow,
    ReminderRow,
    SessionDetail,
    SessionInfo,
    SessionRow,
    utcnow,
)


class SessionEnded(Exception):
    """A chunk arrived for a session that has already ended."""


def _now() -> datetime:  # a function so tests can move the clock
    return utcnow()


def refresh(db: Session, row: SessionRow) -> SessionRow:
    """End the session if it has timed out. Persists the change."""
    if row.status == "listening":
        now = _now()
        if now - row.started_at > timedelta(seconds=config.SESSION_MAX_DURATION_S):
            reason = "max_duration"
        elif now - row.last_activity_at > timedelta(seconds=config.SESSION_SILENCE_TIMEOUT_S):
            reason = "silence_timeout"
        else:
            return row
        row.status, row.end_reason = "ended", reason
        # A timed-out session ended when it went quiet, not when we noticed.
        row.ended_at = (
            row.started_at + timedelta(seconds=config.SESSION_MAX_DURATION_S)
            if reason == "max_duration"
            else row.last_activity_at + timedelta(seconds=config.SESSION_SILENCE_TIMEOUT_S)
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def start(db: Session, session_id: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None:
        now = _now()
        row = SessionRow(id=session_id, started_at=now, last_activity_at=now)
        db.add(row)
        db.commit()
        db.refresh(row)
    return refresh(db, row)


def touch(db: Session, session_id: str) -> SessionRow:
    """Register a chunk. Starts the session if new, refuses if it already ended."""
    row = start(db, session_id)
    if row.status == "ended":
        raise SessionEnded(row.end_reason or "ended")
    row.last_activity_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def accept_chunk(db: Session, session_id: str, captured_at: datetime | None = None) -> SessionRow:
    """Register a chunk, or accept a late one that was spoken while the session was live.

    A phone that lost signal sends its buffered chunks later. If the chunk says
    when it was captured and that falls inside the session, it still belongs to
    it, even though the session has since ended. That path does not extend the
    session or change its state.
    """
    try:
        return touch(db, session_id)
    except SessionEnded:
        row = db.get(SessionRow, session_id)
        slack = timedelta(seconds=config.LATE_CHUNK_TOLERANCE_S)
        if (
            captured_at is not None
            and row.ended_at is not None
            and row.started_at - slack <= captured_at <= row.ended_at + slack
        ):
            return row
        raise


def end(db: Session, row: SessionRow) -> SessionRow:
    row = refresh(db, row)
    if row.status == "listening":
        row.status, row.end_reason, row.ended_at = "ended", "user", _now()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row  # ending twice is harmless and keeps the first reason


def detail(db: Session, row: SessionRow) -> SessionDetail:
    reminders = db.exec(
        select(ReminderRow)
        .where(ReminderRow.session_id == row.id)
        .order_by(ReminderRow.created_at, ReminderRow.id)
    )
    actions = db.exec(
        select(ActionRow).where(ActionRow.session_id == row.id).order_by(ActionRow.created_at, ActionRow.id)
    )
    pending = db.exec(select(PendingChunkRow.id).where(PendingChunkRow.session_id == row.id)).all()
    info = SessionInfo.model_validate(row.model_dump())
    return SessionDetail(
        **info.model_dump(),
        reminders=[r.to_api() for r in reminders],
        actions=[a.to_api() for a in actions],
        pending_chunks=len(pending),
    )


# Repeats of a relative time ("in 30 minutes" said twice) differ by seconds, so
# deadlines within this window count as the same commitment.
DUPLICATE_DEADLINE_WINDOW = timedelta(minutes=5)


def _identity(title: str, location) -> tuple:
    loc = location or {}
    return (
        " ".join(title.lower().split()),
        (loc.get("name") or "").lower(),
        (loc.get("category") or "").lower(),
    )


def _same_deadline(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= DUPLICATE_DEADLINE_WINDOW


def drop_duplicates(db: Session, session_id: str, candidates: list) -> list:
    """Remove candidates that repeat a reminder already saved in this session.

    Chunks overlap when the app re-sends the tail of the last one, and people
    repeat themselves, so the same commitment can arrive twice.
    """
    seen = [
        (_identity(r.title, r.location), r.deadline)
        for r in db.exec(select(ReminderRow).where(ReminderRow.session_id == session_id))
    ]
    kept = []
    for c in candidates:
        ident = _identity(c.title, c.location.model_dump(exclude_none=True) if c.location else None)
        if any(ident == i and _same_deadline(c.deadline, d) for i, d in seen):
            continue
        seen.append((ident, c.deadline))
        kept.append(c)
    return kept
