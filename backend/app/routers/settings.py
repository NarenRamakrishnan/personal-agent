import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, update
from sqlmodel import Session, func, select

from app import chunks, config, retention, settings
from app.db import get_session
from app.models import ActionRow, PendingChunkRow, ReminderRow, Settings, SettingsUpdate
from app.security import require_api_key

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_api_key)])


@router.get("", response_model=Settings, response_model_exclude_none=True)
def get_settings(db: Session = Depends(get_session)):
    """Every setting with its current value (defaults if never changed)."""
    return settings.to_api(settings.get_row(db))


@router.patch("", response_model=Settings, response_model_exclude_none=True)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_session)):
    """Change any subset of settings. Only the fields sent are touched.

    Turning "keep what I said" off also erases what is already kept, and
    shortening how long words are kept applies to existing ones straight away:
    a privacy switch should mean the same thing for the past as for the future.
    Chunks still waiting for the model get one last try first, so a commitment in
    them isn't lost along with the words; the response says how many weren't saved.
    """
    row = settings.get_row(db)
    sent = body.model_fields_set
    changes = body.model_dump(exclude_unset=True)

    mode = changes.get("timezone_mode", row.timezone_mode)
    tz = changes["timezone"] if "timezone" in sent else row.timezone
    if mode == "manual" and not tz:
        raise HTTPException(status_code=422, detail="Choose a timezone to use manual mode, e.g. America/New_York")
    if "timezone_mode" in sent:
        row.timezone_mode = mode
    if "timezone" in sent:
        row.timezone = tz
    if "quiet_hours" in sent:
        q = body.quiet_hours
        row.quiet_start, row.quiet_end = (q.start, q.end) if q else (None, None)
    if body.times_of_day is not None:
        for key, value in body.times_of_day.model_dump(exclude_none=True).items():
            setattr(row, key, value)
    for key in ("notify_level", "near_radius_meters"):
        if changes.get(key) is not None:
            setattr(row, key, changes[key])

    turned_off = "keep_transcripts" in sent and body.keep_transcripts is False and row.keep_transcripts
    if "keep_transcripts" in sent and body.keep_transcripts is not None:
        row.keep_transcripts = body.keep_transcripts
    if "delete_transcripts_after_days" in sent:
        row.delete_transcripts_after_days = body.delete_transcripts_after_days

    db.add(row)
    db.commit()
    db.refresh(row)

    unparsed = None
    if turned_off:
        unparsed = _parse_queued_chunks(db)
        for model in (ReminderRow, ActionRow):
            db.execute(update(model).where(model.source_text.is_not(None)).values(source_text=None))
        db.execute(delete(PendingChunkRow))
        db.commit()
    if "delete_transcripts_after_days" in sent:
        retention.purge_expired(db)
    out = settings.to_api(row)
    if unparsed is not None:
        out.unparsed_chunks_deleted = unparsed
    return out


def _parse_queued_chunks(db: Session) -> int:
    """Give every queued chunk a last try within one time limit, oldest session first.
    What's saved has no words (keep_transcripts is already off). Returns how many
    chunks are still queued, which the caller then deletes."""
    started = time.monotonic()
    session_ids = db.exec(
        select(PendingChunkRow.session_id).group_by(PendingChunkRow.session_id)
        .order_by(func.min(PendingChunkRow.captured_at))
    ).all()
    left = 0
    for sid in session_ids:
        budget = config.PENDING_RETRY_BUDGET_S - (time.monotonic() - started)
        if budget < chunks.MIN_CALL_S:
            left += chunks.pending_count(db, sid)
            continue
        try:
            left += chunks.retry_pending(db, sid, budget_s=budget)
        except Exception:  # noqa: BLE001 - the switch must still turn off
            db.rollback()
            left += chunks.pending_count(db, sid)
    return left
