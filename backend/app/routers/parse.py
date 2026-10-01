import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app import parser
from app.db import get_session
from app.models import (
    ParsedReminder,
    ParsedReminderResponse,
    ParseRequest,
    ParseResponse,
    ReminderCreate,
    utcnow,
)
from app.routers.reminders import row_from_create
from app.security import require_api_key

router = APIRouter(tags=["parse"], dependencies=[Depends(require_api_key)])


def to_parsed(c: ReminderCreate) -> ParsedReminder:
    return ParsedReminder(
        title=c.title, deadline=c.deadline, trigger_type=c.trigger_type, location=c.location
    )


@router.post("/parse", response_model=ParsedReminderResponse, response_model_exclude_none=True)
def parse_text(body: ParseRequest):
    """Typed or confirmed input: parse one reminder and save nothing.

    The phone shows its confirm screen and then POSTs /reminders.
    """
    candidates = parser.parse(body.text, body.now or utcnow(), "unsaved", body.timezone)
    if not candidates:
        raise HTTPException(status_code=422, detail="No reminder found in that text")
    first, rest = to_parsed(candidates[0]), [to_parsed(c) for c in candidates[1:]]
    return ParsedReminderResponse(**first.model_dump(), additional=rest or None)


@router.post("/sessions/parse", response_model=ParseResponse, response_model_exclude_none=True)
def parse_into_session(body: ParseRequest, db: Session = Depends(get_session)):
    """Always-listening input: parse every commitment in the text and save them
    under a session, ready for the end-of-session review list."""
    session_id = body.session_id or str(uuid.uuid4())
    candidates = parser.parse(body.text, body.now or utcnow(), session_id, body.timezone)
    rows = [row_from_create(c) for c in candidates]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return ParseResponse(session_id=session_id, reminders=[r.to_api() for r in rows])
