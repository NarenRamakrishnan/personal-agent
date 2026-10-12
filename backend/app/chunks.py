"""Turning a chunk of speech into saved reminders, without losing it (Module 10).

If the model can't be reached, the chunk is queued instead of dropped, and
retried when the session ends, when the app asks, or after the next good chunk.

A retry claims a chunk before parsing it, so two callers (an end and a retry, say)
can't both process it, and the reminders and the removal of the chunk land in one
commit, so a crash can't leave it parsed but still queued.
"""

import logging
import re
import time
from datetime import datetime, timedelta

from sqlalchemy import case, delete, or_, update
from sqlmodel import Session, func, select

from app import config, parser, sessions, settings
from app.models import PendingChunkRow, Reminder, ReminderRow, readable, row_from_create, utcnow

log = logging.getLogger(__name__)

CLAIM_TTL = timedelta(minutes=2)  # a claim older than this is from a caller that died
MAX_CONSECUTIVE_FAILURES = 2  # a retry pass stops after this many outages in a row
MIN_CALL_S = 3  # with less time than this left, don't start another model call


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


# How many open reminders the model is shown. Each costs prompt tokens on every chunk,
# and the spend guard counts tokens, so this session's come first, then the newest.
OPEN_REMINDERS_MAX = 15


def open_reminders(db: Session, session_id: str) -> dict[str, Reminder]:
    """Open reminders keyed by a short ref (r1, r2...). The model only ever sees the
    refs, so a change it asks for can only reach a reminder listed here."""
    rows = db.exec(
        select(ReminderRow)
        .where(ReminderRow.completed == False, ReminderRow.title != parser.UNREADABLE_TITLE)  # noqa: E712
        # case, not a bare comparison: Postgres sorts NULL (typed reminders) first on DESC.
        .order_by(case((ReminderRow.session_id == session_id, 0), else_=1), ReminderRow.created_at.desc(), ReminderRow.id)
        .limit(OPEN_REMINDERS_MAX)
    ).all()
    return {f"r{i}": r for i, r in enumerate(readable(rows), 1)}


def parse_candidates(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> list:
    """Parse and drop repeats. Writes nothing. Raises llm.LLMError if the model can't be used.

    Returns new reminders (ReminderCreate) and changes to open ones (parser.Change)."""
    if is_filler(text):
        return []
    found = parser.parse(text, now, session_id, tz_name, fallback=False, times=settings.load(db).times,
                         open_reminders=open_reminders(db, session_id))
    changes = [c for c in found if isinstance(c, parser.Change)]
    candidates = [c for c in found if not isinstance(c, parser.Change)]
    for c in candidates:
        c.session_id = session_id  # never trust the parser to have set it
    return sessions.drop_duplicates(db, session_id, candidates) + changes


def _apply(db: Session, change: "parser.Change", session_id: str) -> ReminderRow | None:
    row = db.get(ReminderRow, change.reminder_id)
    if row is None or row.completed:
        return None  # deleted or finished since the model saw it
    if change.action == "complete":
        row.completed = True
    else:
        for key, value in change.fields.items():
            if key == "location":
                value = value.model_dump(exclude_none=True) if value is not None else None
            setattr(row, key, value)
    row.changed_in_session = session_id
    db.add(row)
    return row


def _save(db: Session, candidates: list, remove_chunk_id: str | None = None,
          session_id: str | None = None) -> tuple[list[ReminderRow], list[ReminderRow]]:
    """New reminders and changes land in one commit with the chunk's removal.
    Returns (created, changed)."""
    keep = settings.load(db).keep_transcripts
    new = [c for c in candidates if not isinstance(c, parser.Change)]
    rows = [row_from_create(c, keep_text=keep) for c in new]
    db.add_all(rows)
    changed = [r for c in candidates if isinstance(c, parser.Change) if (r := _apply(db, c, session_id)) is not None]
    if remove_chunk_id:
        db.execute(delete(PendingChunkRow).where(PendingChunkRow.id == remove_chunk_id))
    db.commit()
    for row in rows + changed:
        db.refresh(row)
    return rows, changed


def ingest(db: Session, session_id: str, text: str, now: datetime, tz_name: str | None) -> tuple[list[ReminderRow], list[ReminderRow]]:
    """Parse and save. Returns (created, changed). Raises llm.LLMError if the model can't be used."""
    return _save(db, parse_candidates(db, session_id, text, now, tz_name), session_id=session_id)


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
    retrying: keep it as a reminder with no deadline and a neutral title, so it lands in
    the review list for the person to fix or delete, instead of being dropped or
    retried forever."""
    db.rollback()
    row = db.get(PendingChunkRow, chunk_id)
    if row is None:
        return
    if row.attempts + 1 >= config.PENDING_MAX_ATTEMPTS:
        log.warning("pending chunk given up after %d unusable replies; kept for review", row.attempts + 1)
        # They all share one title, so match on the words: the same chunk sent twice is
        # one reminder, two different unreadable chunks are two.
        already = db.exec(
            select(ReminderRow.id).where(
                ReminderRow.session_id == session_id,
                ReminderRow.title == parser.UNREADABLE_TITLE,
                ReminderRow.source_text == text,
            )
        ).first()
        _save(db, [] if already else parser.parse_unreadable(text, session_id), remove_chunk_id=chunk_id)
        return
    row.attempts, row.claimed_at = row.attempts + 1, None
    db.add(row)
    db.commit()


def retry_pending(db: Session, session_id: str, limit: int | None = None, budget_s: float | None = None) -> int:
    """Re-parse queued chunks oldest first.

    A chunk the model answers but can't parse is counted and skipped, so it never
    blocks the ones behind it, and after PENDING_MAX_ATTEMPTS it becomes a reminder to
    review. An outage (no answer at all) isn't the chunk's fault: it doesn't count, and
    two in a row end the pass. A refused request counts only if another call in the
    same pass got an answer, so a bad config can't use up every chunk's attempts. A
    spent budget ends the pass at once.

    budget_s: seconds the whole pass may take. Each call gets what's left, and the pass
    stops when too little is left to start one; the rest wait for the next pass.

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
    refused = []  # chunks whose request Nebius rejected: counted only if the config works
    config_ok = False  # some call this pass got a real answer, so the request is fine
    started = time.monotonic()
    for chunk_id, text, captured_at, tz_name in todo:
        left = None if budget_s is None else budget_s - (time.monotonic() - started)
        if left is not None and left < MIN_CALL_S:
            break  # out of time: the rest wait for the next pass
        if not _claim(db, chunk_id):
            continue  # someone else is on it
        try:
            if left is None:
                candidates = parse_candidates(db, session_id, text, captured_at, tz_name)
            else:
                with llm.time_limit(left):
                    candidates = parse_candidates(db, session_id, text, captured_at, tz_name)
            _save(db, candidates, remove_chunk_id=chunk_id, session_id=session_id)
            outages, config_ok = 0, True
        except llm.BudgetError as e:
            log.warning("pending chunk retry stopped: %s", type(e).__name__)
            _release(db, chunk_id)
            break  # over budget: every chunk behind this one would be refused too
        except llm.RequestRefused as e:
            # This chunk, or our own request that every chunk would get. Hold it until
            # another call shows which; two in a row with no answer looks like config.
            log.warning("pending chunk request refused: %s", type(e).__name__)
            _release(db, chunk_id)
            refused.append((chunk_id, text))
            if not config_ok and len(refused) >= MAX_CONSECUTIVE_FAILURES:
                log.error("every request is being refused: check NEBIUS_MODEL and the request options")
                break
        except llm.ReplyError as e:
            # The model is up (it answered); this chunk is the problem. Move on.
            log.warning("pending chunk got an unusable reply: %s", type(e).__name__)
            _count_failure(db, chunk_id, session_id, text)
            outages, config_ok = 0, True
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
    if config_ok:
        for chunk_id, text in refused:
            _count_failure(db, chunk_id, session_id, text)
    return pending_count(db, session_id)
