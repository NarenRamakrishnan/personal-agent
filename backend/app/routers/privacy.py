from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, update
from sqlmodel import Session, func, select

from app import settings
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
    return db.exec(select(func.count()).select_from(model).where(*where)).one()


@router.get("/privacy", response_model=PrivacyInfo)
def privacy_info(db: Session = Depends(get_session)):
    """What this backend keeps. Facts from its config, the person's settings and the
    database, nothing promised beyond that."""
    prefs = settings.load(db)
    return PrivacyInfo(
        audio_stored=False,  # no endpoint accepts audio; only text reaches the backend
        store_transcripts=prefs.keep_transcripts,
        transcript_retention_days=prefs.retention_days,
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
    erased = sum(
        db.execute(
            update(m).where(m.session_id == session_id, m.source_text.is_not(None)).values(source_text=None)
        ).rowcount
        for m in (ReminderRow, ActionRow)
    )
    pending = db.execute(delete(PendingChunkRow).where(PendingChunkRow.session_id == session_id)).rowcount
    db.commit()
    return {"transcriptsErased": erased, "pendingChunksDeleted": pending}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_session)):
    """Delete a session and everything it produced."""
    _session_or_404(db, session_id)
    for model in (ReminderRow, ActionRow, PendingChunkRow):
        db.execute(delete(model).where(model.session_id == session_id))
    db.execute(delete(SessionRow).where(SessionRow.id == session_id))
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
        counts[label] = db.execute(delete(model)).rowcount
    db.commit()
    return {"deleted": counts}
