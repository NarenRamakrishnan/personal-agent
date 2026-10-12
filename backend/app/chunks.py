"""Turning a chunk of speech into saved reminders, without losing it (Module 10).

If the model can't be reached, the chunk is queued instead of dropped, and
retried when the session ends, when the app asks, or after the next good chunk.

A retry claims a chunk before parsing it, so two callers (an end and a retry, say)
can't both process it, and the reminders and the removal of the chunk land in one
commit, so a crash can't leave it parsed but still queued.
"""

import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, update
from sqlmodel import Session, func, select

from app import config, parser, sessions, settings
from app.models import PendingChunkRow, ReminderCreate, ReminderRow, row_from_create, utcnow

log = logging.getLogger(__name__)

CLAIM_TTL = timedelta(minutes=2)  # a claim older than this is from a caller that died
MAX_CONSECUTIVE_FAILURES = 2  # a retry pass stops after this many outages in a row


# Words that never make a commitment on their own. A chunk made only of these
# ("yeah okay", "mm-hmm", "thank you") is skipped without a model call: most of
# what an always-listening phone hears is this, and the spend guard counts calls.
FILLER = {
    "ok", "okay", "alright", "right", "yeah", "yep", "yup", "yes", "no", "nope", "nah",
    "sure", "cool", "nice", "wow", "lol", "hmm", "hm", "mm", "mhm", "uh", "um",
    "ah", "oh", "huh", "like", "so", "well", "hi", "hey", "hello", "bye", "thanks",
    "thank", "you", "sorry", "mm-hmm", "uh-huh",
}


def is_filler(text: str) -> bool:
    return all(w in FILLER for w in re.findall(r"[a-z]+(?:-[a-z]+)*", text.lower()))


def parse_candidates(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> list[ReminderCreate]:
    """Parse and drop repeats. Writes nothing. Raises llm.LLMError if the model can't be used."""
    if is_filler(text):
        return []
    candidates = parser.parse(text, now, session_id, tz_name, fallback=False, times=settings.load(db).times)
    for c in candidates:
        c.session_id = session_id  # never trust the parser to have set it
    return sessions.drop_duplicates(db, session_id, candidates)


def _save(db: Session, candidates: list[ReminderCreate], remove_chunk_id: str | None = None) -> list[ReminderRow]:
    keep = settings.load(db).keep_transcripts
    rows = [row_from_create(c, keep_text=keep) for c in candidates]
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


def queue(db: Session, session_id: str, text: str, captured_at: datetime, tz_name: str | None, attempts: int = 0) -> bool:
    """Keep an unparsed chunk. Returns False if transcripts are not allowed to be stored.

    attempts: 1 when the model already answered unusably (llm.ReplyError), 0 for an outage.
    """
    if not settings.load(db).keep_transcripts:
        return False
    db.add(PendingChunkRow(session_id=session_id, text=text, captured_at=captured_at, timezone=tz_name, attempts=attempts))
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


def _count_failure(db: Session, chunk_id: str, session_id: str, text: str) -> None:
    """The model answered but couldn't parse this chunk. Count it, and at the limit stop
    retrying: keep the words as a reminder with no deadline, so they land in the review
    list for the person to fix or delete, instead of being dropped or retried forever."""
    db.rollback()
    row = db.get(PendingChunkRow, chunk_id)
    if row is None:
        return
    if row.attempts + 1 >= config.PENDING_MAX_ATTEMPTS:
        log.warning("pending chunk given up after %d unusable replies; kept for review", row.attempts + 1)
        kept = sessions.drop_duplicates(db, session_id, parser.parse_fallback(text, session_id))
        _save(db, kept, remove_chunk_id=chunk_id)
        return
    row.attempts, row.claimed_at = row.attempts + 1, None
    db.add(row)
    db.commit()


def retry_pending(db: Session, session_id: str, limit: int | None = None) -> int:
    """Re-parse queued chunks oldest first.

    A chunk the model answers but can't parse is counted and skipped, so it never
    blocks the ones behind it, and after PENDING_MAX_ATTEMPTS it becomes a reminder to
    review. An outage (no answer at all) isn't the chunk's fault: it doesn't count, and
    two in a row end the pass. A spent budget ends it at once.

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
    outages = 0
    for chunk_id, text, captured_at, tz_name in todo:
        if not _claim(db, chunk_id):
            continue  # someone else is on it
        try:
            candidates = parse_candidates(db, session_id, text, captured_at, tz_name)
            _save(db, candidates, remove_chunk_id=chunk_id)
            outages = 0
        except llm.BudgetError as e:
            log.warning("pending chunk retry stopped: %s", type(e).__name__)
            _release(db, chunk_id)
            break  # over budget: every chunk behind this one would be refused too
        except llm.ReplyError as e:
            # The model is up (it answered); this chunk is the problem. Move on.
            log.warning("pending chunk got an unusable reply: %s", type(e).__name__)
            _count_failure(db, chunk_id, session_id, text)
            outages = 0
        except llm.LLMError as e:
            log.warning("pending chunk retry failed: %s", type(e).__name__)
            _release(db, chunk_id)
            outages += 1
            if outages >= MAX_CONSECUTIVE_FAILURES:
                break  # the model is probably down: don't hammer it
        except Exception as e:  # noqa: BLE001 - leave the chunk queued, never lose it
            log.error("pending chunk retry failed: %s", type(e).__name__)
            _release(db, chunk_id)
            break
    return pending_count(db, session_id)
