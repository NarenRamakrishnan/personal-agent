"""Turning a chunk of speech into saved reminders, without losing it (Module 10).

If the model can't be reached, the chunk is queued instead of dropped, and
retried when the session ends, when the app asks, or after the next good chunk.

A retry claims a chunk before parsing it, so two callers (an end and a retry, say)
can't both process it, and the reminders and the removal of the chunk land in one
commit, so a crash can't leave it parsed but still queued.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, update
from sqlmodel import Session, func, select

from app import config, parser, sessions
from app.models import PendingChunkRow, ReminderCreate, ReminderRow, row_from_create, utcnow

log = logging.getLogger(__name__)

CLAIM_TTL = timedelta(minutes=2)  # a claim older than this is from a caller that died


def parse_candidates(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> list[ReminderCreate]:
    """Parse and drop repeats. Writes nothing. Raises llm.LLMError if the model can't be used."""
    candidates = parser.parse(text, now, session_id, tz_name, fallback=False)
    for c in candidates:
        c.session_id = session_id  # never trust the parser to have set it
    return sessions.drop_duplicates(db, session_id, candidates)


def _save(db: Session, candidates: list[ReminderCreate], remove_chunk_id: str | None = None) -> list[ReminderRow]:
    rows = [row_from_create(c) for c in candidates]
    db.add_all(rows)
    if remove_chunk_id:
        db.execute(delete(PendingChunkRow).where(PendingChunkRow.id == remove_chunk_id))
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def ingest(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> list[ReminderRow]:
    """Parse and save. Raises llm.LLMError if the model can't be used."""
    return _save(db, parse_candidates(db, session_id, text, now, tz_name))


def queue(db: Session, session_id: str, text: str, captured_at: datetime, tz_name: str | None) -> bool:
    """Keep an unparsed chunk. Returns False if transcripts are not allowed to be stored."""
    if not config.STORE_TRANSCRIPTS:
        return False
    db.add(PendingChunkRow(session_id=session_id, text=text, captured_at=captured_at, timezone=tz_name))
    db.commit()
    return True


def pending_count(db: Session, session_id: str) -> int:
    return db.exec(select(func.count()).select_from(PendingChunkRow).where(PendingChunkRow.session_id == session_id)).one()


def _claim(db: Session, chunk_id: str) -> bool:
    now = utcnow()
    result = db.execute(
        update(PendingChunkRow)
        .where(PendingChunkRow.id == chunk_id)
        .where(or_(PendingChunkRow.claimed_at.is_(None), PendingChunkRow.claimed_at < now - CLAIM_TTL))
        .values(claimed_at=now)
    )
    db.commit()
    return result.rowcount == 1


def _release(db: Session, chunk_id: str) -> None:
    db.rollback()
    db.execute(update(PendingChunkRow).where(PendingChunkRow.id == chunk_id).values(claimed_at=None))
    db.commit()


def retry_pending(db: Session, session_id: str, limit: int | None = None) -> int:
    """Re-parse queued chunks oldest first. Stops at the first model failure.

    Returns how many are still waiting.
    """
    from app import llm  # local: llm imports usage, which imports db

    limit = config.PENDING_RETRY_LIMIT if limit is None else limit
    todo = [
        (c.id, c.text, c.captured_at, c.timezone)
        for c in db.exec(
            select(PendingChunkRow)
            .where(PendingChunkRow.session_id == session_id)
            .order_by(PendingChunkRow.captured_at, PendingChunkRow.id)
            .limit(limit)
        )
    ]
    for chunk_id, text, captured_at, tz_name in todo:
        if not _claim(db, chunk_id):
            continue  # someone else is on it
        try:
            candidates = parse_candidates(db, session_id, text, captured_at, tz_name)
            _save(db, candidates, remove_chunk_id=chunk_id)
        except llm.LLMError as e:
            log.warning("pending chunk retry stopped: %s", type(e).__name__)
            _release(db, chunk_id)
            break
        except Exception as e:  # noqa: BLE001 - leave the chunk queued, never lose it
            log.error("pending chunk retry failed: %s", type(e).__name__)
            _release(db, chunk_id)
            break
    return pending_count(db, session_id)
