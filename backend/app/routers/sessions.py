import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from app import chunks, config, llm, sessions
from app.db import get_session
from app.models import SessionDetail, SessionInfo, SessionRow
from app.security import current_owner

router = APIRouter(prefix="/sessions", tags=["sessions"])


def get_or_404(db: Session, session_id: str, owner: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None or row.owner != owner:  # another device's session looks like no session
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions.refresh(db, row)


@router.post("", response_model=SessionInfo, status_code=201, response_model_exclude_none=True)
def start_session(db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    row = sessions.start(db, str(uuid.uuid4()), owner)
    return SessionInfo.model_validate(row.model_dump())


@router.get("/{session_id}", response_model=SessionDetail, response_model_exclude_none=True)
def get_session_detail(session_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    return sessions.detail(db, get_or_404(db, session_id, owner))


@router.post("/{session_id}/end", response_model=SessionDetail, response_model_exclude_none=True)
def end_session(session_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    row = sessions.end(db, get_or_404(db, session_id, owner))
    # Anything the model missed gets another chance before review, within a time limit.
    with llm.charged_to(owner):
        chunks.retry_pending(db, row.id, budget_s=config.REQUEST_BUDGET_S, owner=owner)
    return sessions.detail(db, row)


@router.post("/{session_id}/retry", response_model=SessionDetail, response_model_exclude_none=True)
def retry_session(session_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """Re-try chunks the model couldn't parse earlier. Safe to call any time."""
    row = get_or_404(db, session_id, owner)
    with llm.charged_to(owner):
        chunks.retry_pending(db, row.id, budget_s=config.REQUEST_BUDGET_S, owner=owner)
    return sessions.detail(db, row)
