import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from app import chunks, sessions
from app.db import get_session
from app.models import SessionDetail, SessionInfo, SessionRow
from app.security import require_api_key

router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(require_api_key)])


def get_or_404(db: Session, session_id: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions.refresh(db, row)


@router.post("", response_model=SessionInfo, status_code=201, response_model_exclude_none=True)
def start_session(db: Session = Depends(get_session)):
    row = sessions.start(db, str(uuid.uuid4()))
    return SessionInfo.model_validate(row.model_dump())


@router.get("/{session_id}", response_model=SessionDetail, response_model_exclude_none=True)
def get_session_detail(session_id: str, db: Session = Depends(get_session)):
    return sessions.detail(db, get_or_404(db, session_id))


@router.post("/{session_id}/end", response_model=SessionDetail, response_model_exclude_none=True)
def end_session(session_id: str, db: Session = Depends(get_session)):
    row = sessions.end(db, get_or_404(db, session_id))
    chunks.retry_pending(db, row.id)  # anything the model missed gets another chance before review
    return sessions.detail(db, row)


@router.post("/{session_id}/retry", response_model=SessionDetail, response_model_exclude_none=True)
def retry_session(session_id: str, db: Session = Depends(get_session)):
    """Re-try chunks the model couldn't parse earlier. Safe to call any time."""
    row = get_or_404(db, session_id)
    chunks.retry_pending(db, row.id)
    return sessions.detail(db, row)
