from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select

from app.db import get_session
from app.models import Reminder, ReminderCreate, ReminderRow, ReminderUpdate
from app.security import require_api_key

router = APIRouter(prefix="/reminders", tags=["reminders"], dependencies=[Depends(require_api_key)])


def get_or_404(db: Session, reminder_id: str) -> ReminderRow:
    row = db.get(ReminderRow, reminder_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return row


def row_from_create(body: ReminderCreate) -> ReminderRow:
    data = body.model_dump(exclude={"id", "created_at"})
    data["location"] = body.location.model_dump(exclude_none=True) if body.location else None
    row = ReminderRow(**data)
    if body.id:
        row.id = body.id
    if body.created_at:
        row.created_at = body.created_at
    return row


@router.post("", response_model=Reminder, response_model_exclude_none=True, status_code=201)
def create_reminder(body: ReminderCreate, db: Session = Depends(get_session)):
    if body.id and db.get(ReminderRow, body.id):
        raise HTTPException(status_code=409, detail="A reminder with this id already exists")
    row = row_from_create(body)
    db.add(row)
    db.commit()
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
    return [row.to_api() for row in db.exec(query.offset(offset).limit(limit))]


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
