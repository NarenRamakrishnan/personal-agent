from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select

from app import config
from app.db import get_session
from app.models import (
    ActionRow,
    PendingChunkRow,
    PrivacyCounts,
    PrivacyInfo,
    ReminderRow,
    SavedPlaceRow,
    SessionRow,
)
from app.security import require_api_key

router = APIRouter(tags=["privacy"], dependencies=[Depends(require_api_key)])


def _count(db: Session, model, *where) -> int:
    return len(db.exec(select(model.id if hasattr(model, "id") else model.name).where(*where)).all())


@router.get("/privacy", response_model=PrivacyInfo)
def privacy_info(db: Session = Depends(get_session)):
    """What this backend keeps. Facts from its config and database, nothing promised beyond that."""
    return PrivacyInfo(
        audio_stored=False,  # no endpoint accepts audio; only text reaches the backend
        store_transcripts=config.STORE_TRANSCRIPTS,
        transcript_retention_days=config.TRANSCRIPT_RETENTION_DAYS,
        counts=PrivacyCounts(
            sessions=_count(db, SessionRow),
            reminders=_count(db, ReminderRow),
            reminders_with_transcript=_count(db, ReminderRow, ReminderRow.source_text.is_not(None)),
            actions=_count(db, ActionRow),
            pending_chunks=_count(db, PendingChunkRow),
            saved_places=_count(db, SavedPlaceRow),
        ),
    )


def _session_or_404(db: Session, session_id: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return row


@router.delete("/sessions/{session_id}/transcript")
def delete_session_transcript(session_id: str, db: Session = Depends(get_session)):
    """Erase the words a session's reminders and drafts were parsed from, and any
    queued chunks. The reminders and drafts themselves stay."""
    _session_or_404(db, session_id)
    erased = 0
    for model in (ReminderRow, ActionRow):
        for row in db.exec(select(model).where(model.session_id == session_id, model.source_text.is_not(None))):
            row.source_text = None
            db.add(row)
            erased += 1
    pending = db.exec(select(PendingChunkRow).where(PendingChunkRow.session_id == session_id)).all()
    for chunk in pending:
        db.delete(chunk)
    db.commit()
    return {"transcriptsErased": erased, "pendingChunksDeleted": len(pending)}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_session)):
    """Delete a session and everything it produced."""
    row = _session_or_404(db, session_id)
    for model in (ReminderRow, ActionRow, PendingChunkRow):
        for item in db.exec(select(model).where(model.session_id == session_id)):
            db.delete(item)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.delete("/history")
def delete_history(
    confirm: str = Query(default=""),
    saved_places: bool = Query(default=False, alias="savedPlaces"),
    db: Session = Depends(get_session),
):
    """Delete all sessions, reminders, drafts and queued chunks. Saved places only
    if asked. Needs ?confirm=delete-everything so a stray call can't wipe it."""
    if confirm != "delete-everything":
        raise HTTPException(status_code=400, detail="Add ?confirm=delete-everything to proceed")
    counts = {}
    models = [("reminders", ReminderRow), ("actions", ActionRow), ("pendingChunks", PendingChunkRow), ("sessions", SessionRow)]
    if saved_places:
        models.append(("savedPlaces", SavedPlaceRow))
    for label, model in models:
        rows = db.exec(select(model)).all()
        for r in rows:
            db.delete(r)
        counts[label] = len(rows)
    db.commit()
    return {"deleted": counts}
