import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from app import parser
from app.db import get_session, init_db
from app.models import (
    ParseRequest,
    ParseResponse,
    Reminder,
    ReminderCreate,
    ReminderRow,
    ReminderUpdate,
    utcnow,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Commitment Tracker API", lifespan=lifespan)

# Expo web runs on another origin in dev. Native apps don't need CORS at all.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/reminders", response_model=Reminder, response_model_exclude_none=True, status_code=201)
def create_reminder(body: ReminderCreate, db: Session = Depends(get_session)):
    if body.id and db.get(ReminderRow, body.id):
        raise HTTPException(status_code=409, detail="A reminder with this id already exists")
    row = row_from_create(body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@app.get("/reminders", response_model=list[Reminder], response_model_exclude_none=True)
def list_reminders(
    session_id: str | None = Query(default=None, alias="sessionId"),
    db: Session = Depends(get_session),
):
    query = select(ReminderRow).order_by(ReminderRow.created_at.desc())
    if session_id:
        query = query.where(ReminderRow.session_id == session_id)
    return [row.to_api() for row in db.exec(query)]


@app.patch("/reminders/{reminder_id}", response_model=Reminder, response_model_exclude_none=True)
def update_reminder(reminder_id: str, body: ReminderUpdate, db: Session = Depends(get_session)):
    row = get_or_404(db, reminder_id)
    # exclude_unset so an explicit null can clear a field (e.g. snoozedUntil)
    # while an omitted field is left alone.
    changes = body.model_dump(exclude_unset=True)
    if "location" in changes and body.location is not None:
        changes["location"] = body.location.model_dump(exclude_none=True)
    if changes.get("title") is None:
        changes.pop("title", None)
    if changes.get("trigger_type") is None:
        changes.pop("trigger_type", None)
    if changes.get("completed") is None:
        changes.pop("completed", None)
    for key, value in changes.items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@app.delete("/reminders/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: str, db: Session = Depends(get_session)):
    db.delete(get_or_404(db, reminder_id))
    db.commit()
    return Response(status_code=204)


@app.post("/parse", response_model=ParseResponse, response_model_exclude_none=True)
def parse_text(body: ParseRequest, db: Session = Depends(get_session)):
    session_id = body.session_id or str(uuid.uuid4())
    candidates = parser.parse(body.text, body.now or utcnow(), session_id, body.timezone)
    rows = [row_from_create(c) for c in candidates]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return ParseResponse(session_id=session_id, reminders=[r.to_api() for r in rows])
