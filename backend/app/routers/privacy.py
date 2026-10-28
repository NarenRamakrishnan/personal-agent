from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, update
from sqlmodel import Session, func, select

from app import settings
from app.db import get_session
from app.models import (
    ActionRow,
    MemoryRow,
    PendingChunkRow,
    PrivacyCounts,
    PrivacyInfo,
    ReminderRow,
    SavedPlaceRow,
    SessionRow,
)
from app.security import current_owner

router = APIRouter(tags=["privacy"])


def _count(db: Session, model, *where) -> int:
    return db.exec(select(func.count()).select_from(model).where(*where)).one()


@router.get("/privacy", response_model=PrivacyInfo)
def privacy_info(db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """What this backend keeps. Facts from its config, the person's settings and the
    database, nothing promised beyond that."""
    prefs = settings.load(db, owner)
    return PrivacyInfo(
        audio_stored=False,  # no endpoint accepts audio; only text reaches the backend
        store_transcripts=prefs.keep_transcripts,
        transcript_retention_days=prefs.retention_days,
        counts=PrivacyCounts(
            sessions=_count(db, SessionRow, SessionRow.owner == owner),
            reminders=_count(db, ReminderRow, ReminderRow.owner == owner),
            reminders_with_transcript=_count(db, ReminderRow, ReminderRow.owner == owner,
                                             ReminderRow.source_text.is_not(None)),
            actions=_count(db, ActionRow, ActionRow.owner == owner),
            pending_chunks=_count(db, PendingChunkRow, PendingChunkRow.owner == owner),
            saved_places=_count(db, SavedPlaceRow, SavedPlaceRow.owner == owner),
        ),
    )


def _session_or_404(db: Session, session_id: str, owner: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None or row.owner != owner:
        raise HTTPException(status_code=404, detail="Session not found")
    return row


@router.delete("/sessions/{session_id}/transcript")
def delete_session_transcript(session_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """Erase the words a session's reminders and drafts were parsed from, and any
    queued chunks. The reminders and drafts themselves stay."""
    _session_or_404(db, session_id, owner)
    erased = sum(
        db.execute(
            update(m).where(m.owner == owner, m.session_id == session_id, m.source_text.is_not(None))
            .values(source_text=None)
        ).rowcount
        for m in (ReminderRow, ActionRow)
    )
    pending = db.execute(delete(PendingChunkRow).where(
        PendingChunkRow.owner == owner, PendingChunkRow.session_id == session_id)).rowcount
    db.commit()
    return {"transcriptsErased": erased, "pendingChunksDeleted": pending}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """Delete a session and everything it produced."""
    _session_or_404(db, session_id, owner)
    for model in (ReminderRow, ActionRow, PendingChunkRow, MemoryRow):
        db.execute(delete(model).where(model.owner == owner, model.session_id == session_id))
    db.execute(delete(SessionRow).where(SessionRow.id == session_id))
    db.commit()
    return Response(status_code=204)


@router.delete("/history")
def delete_history(
    confirm: str = Query(default=""),
    saved_places: bool = Query(default=False, alias="savedPlaces"),
    db: Session = Depends(get_session),
    owner: str = Depends(current_owner),
):
    """Delete all of this device's sessions, reminders, drafts, queued chunks and memories. Saved places only
    if asked. Needs ?confirm=delete-everything so a stray call can't wipe it."""
    if confirm != "delete-everything":
        raise HTTPException(status_code=400, detail="Add ?confirm=delete-everything to proceed")
    counts = {}
    models = [("reminders", ReminderRow), ("actions", ActionRow), ("pendingChunks", PendingChunkRow), ("sessions", SessionRow),
              ("memories", MemoryRow)]
    if saved_places:
        models.append(("savedPlaces", SavedPlaceRow))
    for label, model in models:
        counts[label] = db.execute(delete(model).where(model.owner == owner)).rowcount
    db.commit()
    return {"deleted": counts}
