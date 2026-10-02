"""Transcript retention (Module 10).

Reminders and drafts keep `source_text`, the words they were parsed from. Those
expire after TRANSCRIPT_RETENTION_DAYS: the words are erased, the reminder stays.
Chunks still waiting for the model are deleted outright when they get that old.
"""

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app import config
from app.models import ActionRow, PendingChunkRow, ReminderRow, utcnow


def purge_expired(db: Session, now: datetime | None = None) -> dict:
    days = config.TRANSCRIPT_RETENTION_DAYS
    if days <= 0:
        return {"transcripts_erased": 0, "pending_deleted": 0}
    cutoff = (now or utcnow()) - timedelta(days=days)
    erased = 0
    for model in (ReminderRow, ActionRow):
        for row in db.exec(select(model).where(model.created_at < cutoff, model.source_text.is_not(None))):
            row.source_text = None
            db.add(row)
            erased += 1
    stale = db.exec(select(PendingChunkRow).where(PendingChunkRow.created_at < cutoff)).all()
    for chunk in stale:
        db.delete(chunk)
    db.commit()
    return {"transcripts_erased": erased, "pending_deleted": len(stale)}
