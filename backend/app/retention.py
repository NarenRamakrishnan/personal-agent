"""Transcript retention (Module 10).

Reminders and drafts keep `source_text`, the words they were parsed from. Those
expire after TRANSCRIPT_RETENTION_DAYS: the words are erased, the reminder stays.
Chunks still waiting for the model are deleted outright when they get that old.

There is no background scheduler, so the purge runs at startup and then at most
once an hour, piggy-backed on new sessions starting (maybe_purge).
"""

import logging
import time
from datetime import datetime, timedelta

from sqlalchemy import delete, update
from sqlmodel import Session

from app import config
from app.models import ActionRow, PendingChunkRow, ReminderRow, utcnow

log = logging.getLogger(__name__)

PURGE_INTERVAL_S = 3600
_last_run: float | None = None


def purge_expired(db: Session, now: datetime | None = None) -> dict:
    days = config.TRANSCRIPT_RETENTION_DAYS
    if days <= 0:
        return {"transcripts_erased": 0, "pending_deleted": 0}
    cutoff = (now or utcnow()) - timedelta(days=days)
    erased = 0
    for model in (ReminderRow, ActionRow):
        erased += db.execute(
            update(model).where(model.created_at < cutoff, model.source_text.is_not(None)).values(source_text=None)
        ).rowcount
    pending = db.execute(delete(PendingChunkRow).where(PendingChunkRow.created_at < cutoff)).rowcount
    db.commit()
    return {"transcripts_erased": erased, "pending_deleted": pending}


def maybe_purge(db: Session) -> dict | None:
    """Purge if it has been an hour. Never raises: retention must not break a request."""
    global _last_run
    now = time.monotonic()
    if _last_run is not None and now - _last_run < PURGE_INTERVAL_S:
        return None
    _last_run = now
    try:
        return purge_expired(db)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.error("retention purge failed: %s", type(e).__name__)
        return None
