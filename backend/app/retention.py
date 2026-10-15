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
from sqlmodel import Session, select

from app import config, settings
from app.models import ActionRow, PendingChunkRow, ReminderRow, SettingsRow, utcnow

log = logging.getLogger(__name__)

PURGE_INTERVAL_S = 3600
_last_run: float | None = None


def purge_expired(db: Session, now: datetime | None = None) -> dict:
    """The server's limit applies to everyone; a person who chose fewer days gets theirs
    on their own rows."""
    now = now or utcnow()
    plans = []  # (owner, or None for everyone; days)
    server = config.TRANSCRIPT_RETENTION_DAYS
    if server > 0:
        plans.append((None, server))
    for row in db.exec(select(SettingsRow).where(SettingsRow.delete_transcripts_after_days.is_not(None))):
        days = settings.effective_retention(row.delete_transcripts_after_days)
        if days > 0 and (server <= 0 or days < server):
            plans.append((row.id, days))
    erased = pending = 0
    for owner, days in plans:
        cutoff = now - timedelta(days=days)
        for model in (ReminderRow, ActionRow):
            query = update(model).where(model.created_at < cutoff, model.source_text.is_not(None))
            if owner is not None:
                query = query.where(model.owner == owner)
            erased += db.execute(query.values(source_text=None)).rowcount
        query = delete(PendingChunkRow).where(PendingChunkRow.created_at < cutoff)
        if owner is not None:
            query = query.where(PendingChunkRow.owner == owner)
        pending += db.execute(query).rowcount
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
