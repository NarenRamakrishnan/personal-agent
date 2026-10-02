"""Turning a chunk of speech into saved reminders, without losing it (Module 10).

If the model can't be reached, the chunk is queued instead of dropped, and
retried when the session ends, when the app asks, or after the next good chunk.
"""

import logging
from datetime import datetime

from sqlmodel import Session, select

from app import config, parser, sessions
from app.models import PendingChunkRow, ReminderRow, row_from_create, utcnow

log = logging.getLogger(__name__)


def ingest(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> list[ReminderRow]:
    """Parse and save. Raises llm.LLMError if the model can't be used."""
    candidates = parser.parse(text, now, session_id, tz_name, fallback=False)
    for c in candidates:
        c.session_id = session_id  # never trust the parser to have set it
    candidates = sessions.drop_duplicates(db, session_id, candidates)
    rows = [row_from_create(c) for c in candidates]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def queue(db: Session, session_id: str, text: str, captured_at: datetime, tz_name: str | None) -> bool:
    """Keep an unparsed chunk. Returns False if transcripts are not allowed to be stored."""
    if not config.STORE_TRANSCRIPTS:
        return False
    db.add(PendingChunkRow(session_id=session_id, text=text, captured_at=captured_at, timezone=tz_name))
    db.commit()
    return True


def pending_count(db: Session, session_id: str) -> int:
    return len(db.exec(select(PendingChunkRow.id).where(PendingChunkRow.session_id == session_id)).all())


def retry_pending(db: Session, session_id: str, limit: int | None = None) -> int:
    """Re-parse queued chunks oldest first. Stops at the first model failure.

    Returns how many are still waiting.
    """
    from app import llm  # local: llm imports usage, which imports db

    limit = config.PENDING_RETRY_LIMIT if limit is None else limit
    chunks = db.exec(
        select(PendingChunkRow)
        .where(PendingChunkRow.session_id == session_id)
        .order_by(PendingChunkRow.captured_at, PendingChunkRow.id)
        .limit(limit)
    ).all()
    for chunk in chunks:
        try:
            ingest(db, session_id, chunk.text, chunk.captured_at, chunk.timezone)
        except llm.LLMError as e:
            log.warning("pending chunk retry stopped: %s", type(e).__name__)
            break
        db.delete(chunk)
        db.commit()
    return pending_count(db, session_id)
