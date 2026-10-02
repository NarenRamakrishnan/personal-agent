import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import get_session
from app.models import Reminder, ReminderCreate, ReminderRow, ReminderUpdate, row_from_create
from app.security import require_api_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/reminders", tags=["reminders"], dependencies=[Depends(require_api_key)])


def get_or_404(db: Session, reminder_id: str) -> ReminderRow:
    row = db.get(ReminderRow, reminder_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return row


@router.post("", response_model=Reminder, response_model_exclude_none=True, status_code=201)
def create_reminder(body: ReminderCreate, response: Response, db: Session = Depends(get_session)):
    if body.id:
        existing = db.get(ReminderRow, body.id)
        if existing:
            # The phone supplies its own id, so a retry after a lost response is
            # the same reminder arriving twice: answer it, don't fail it.
            if (existing.title, existing.trigger_type, existing.deadline) == (
                body.title, body.trigger_type, body.deadline
            ):
                response.status_code = 200
                return existing.to_api()
            raise HTTPException(status_code=409, detail="A different reminder has this id")
    row = row_from_create(body)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A reminder with this id already exists")
    db.refresh(row)
    return row.to_api()


@router.get("", response_model=list[Reminder], response_model_exclude_none=True)
def list_reminders(
    session_id: str | None = Query(default=None, alias="sessionId"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_session),
):
    query = select(ReminderRow).order_by(ReminderRow.created_at.desc(), ReminderRow.id)
    if session_id:
        query = query.where(ReminderRow.session_id == session_id)
    out = []
    for row in db.exec(query.offset(offset).limit(limit)):
        try:
            out.append(row.to_api())
        except ValidationError:
            log.error("skipping unreadable reminder row %s", row.id)
    return out


@router.patch("/{reminder_id}", response_model=Reminder, response_model_exclude_none=True)
def update_reminder(reminder_id: str, body: ReminderUpdate, db: Session = Depends(get_session)):
    row = get_or_404(db, reminder_id)
    # exclude_unset: an explicit null clears an optional field (e.g. snoozedUntil),
    # an omitted field is left alone. Required fields can't be nulled.
    changes = body.model_dump(exclude_unset=True)
    if "location" in changes and body.location is not None:
        changes["location"] = body.location.model_dump(exclude_none=True)
    for required in ("title", "trigger_type", "completed"):
        if changes.get(required, "keep") is None:
            changes.pop(required)
    # Re-check the whole reminder as it would look after the change, so a PATCH
    # can't store something the API then refuses to read back.
    try:
        Reminder.model_validate({**row.to_api().model_dump(), **changes})
    except ValidationError as e:
        raise HTTPException(status_code=422, detail="; ".join(x["msg"] for x in e.errors()))
    for key, value in changes.items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: str, db: Session = Depends(get_session)):
    db.delete(get_or_404(db, reminder_id))
    db.commit()
    return Response(status_code=204)
