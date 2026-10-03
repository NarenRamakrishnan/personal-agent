import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from app import chunks, llm, parser, sessions, settings
from app.db import get_session
from app.models import (
    ParsedReminder,
    ParsedReminderResponse,
    ParseRequest,
    ParseResponse,
    ReminderCreate,
    utcnow,
)
from app.security import require_api_key

router = APIRouter(tags=["parse"], dependencies=[Depends(require_api_key)])


def to_parsed(c: ReminderCreate) -> ParsedReminder:
    return ParsedReminder(
        title=c.title,
        deadline=c.deadline,
        trigger_type=c.trigger_type,
        location=c.location,
    )


@router.post("/parse", response_model=ParsedReminderResponse, response_model_exclude_none=True)
def parse_text(body: ParseRequest, db: Session = Depends(get_session)):
    """Typed or confirmed input: parse one reminder and save nothing.

    The phone shows its confirm screen and then POSTs /reminders.
    """
    prefs = settings.load(db)
    tz_name = settings.timezone_for(prefs, body.timezone)
    candidates = parser.parse(body.text, body.now or utcnow(), "unsaved", tz_name, times=prefs.times)
    if not candidates:
        raise HTTPException(status_code=422, detail="No reminder found in that text")
    first, rest = to_parsed(candidates[0]), [to_parsed(c) for c in candidates[1:]]
    return ParsedReminderResponse(**first.model_dump(), additional=rest or None)


@router.post("/sessions/parse", response_model=ParseResponse, response_model_exclude_none=True)
def parse_into_session(body: ParseRequest, response: Response, db: Session = Depends(get_session)):
    """Always-listening input: parse every commitment in the text and save them
    under a session, ready for the end-of-session review list.

    If the model can't be reached the chunk is kept and retried (202), so a
    network or model failure does not lose what the person said.
    """
    session_id = body.session_id or str(uuid.uuid4())
    try:
        sessions.accept_chunk(db, session_id, body.captured_at)
    except sessions.SessionEnded as e:
        raise HTTPException(
            status_code=409, detail=f"Session already ended ({e}). Start a new session."
        )
    # Relative words ("tonight") resolve against when the speech happened, which for a
    # buffered chunk is captured_at and not the later moment it was sent.
    now = body.captured_at or body.now or utcnow()
    tz_name = settings.timezone_for(settings.load(db), body.timezone)
    try:
        rows = chunks.ingest(db, session_id, body.text, now, tz_name)
    except llm.LLMError:
        if not chunks.queue(db, session_id, body.text, now, tz_name):
            # Transcripts may not be stored, so there is nowhere safe to keep it.
            raise HTTPException(status_code=503, detail="Parsing is temporarily unavailable")
        response.status_code = 202
        return ParseResponse(session_id=session_id, reminders=[], pending_chunks=chunks.pending_count(db, session_id))
    saved = [r.to_api() for r in rows]  # before the retry's commit expires these row objects
    remaining = chunks.pending_count(db, session_id)
    if remaining:
        try:  # best effort: this chunk is already saved, so a failure here must not become a 500
            remaining = chunks.retry_pending(db, session_id, limit=2)
        except Exception as e:  # noqa: BLE001
            logging.getLogger(__name__).warning("backlog retry skipped: %s", type(e).__name__)
            db.rollback()
    return ParseResponse(session_id=session_id, reminders=saved, pending_chunks=remaining)
