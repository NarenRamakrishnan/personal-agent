from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from app import places, timelogic
from app.db import get_session
from app.models import (
    EvaluateRequest,
    EvaluateResponse,
    LocationSignal,
    ReminderRow,
    SavedPlace,
    SavedPlaceRow,
    utcnow,
)
from app.security import require_api_key

router = APIRouter(tags=["evaluate"], dependencies=[Depends(require_api_key)])


def _row_to_api(row: SavedPlaceRow) -> SavedPlace:
    return SavedPlace(name=row.name, latitude=row.latitude, longitude=row.longitude,
                      radius_meters=row.radius_meters)


@router.get("/saved-places", response_model=list[SavedPlace])
def list_saved_places(db: Session = Depends(get_session)):
    return [_row_to_api(r) for r in db.exec(select(SavedPlaceRow).order_by(SavedPlaceRow.name))]


@router.put("/saved-places/{name}", response_model=SavedPlace)
def put_saved_place(name: str, body: SavedPlace, db: Session = Depends(get_session)):
    key = places.saved_place_name(name)
    if not key:
        raise HTTPException(status_code=422, detail="name is required")
    row = db.get(SavedPlaceRow, key) or SavedPlaceRow(name=key, latitude=0, longitude=0)
    row.latitude, row.longitude, row.radius_meters = body.latitude, body.longitude, body.radius_meters
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_api(row)


@router.delete("/saved-places/{name}", status_code=204)
def delete_saved_place(name: str, db: Session = Depends(get_session)):
    row = db.get(SavedPlaceRow, places.saved_place_name(name))
    if row is None:
        raise HTTPException(status_code=404, detail="Saved place not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post("/evaluate-reminder", response_model=EvaluateResponse, response_model_exclude_none=True)
def evaluate_reminder(body: EvaluateRequest, db: Session = Depends(get_session)):
    """The time and location signals for one reminder (the scoring engine builds on these)."""
    if body.reminder_id is not None:
        row = db.get(ReminderRow, body.reminder_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Reminder not found")
        reminder = row.to_api()
    else:
        reminder = body.reminder
    now = body.context.now or utcnow()

    def lookup(name):
        r = db.get(SavedPlaceRow, name)
        return (r.latitude, r.longitude, r.radius_meters) if r else None

    signal = places.evaluate_location(reminder, body.context, lookup)
    return EvaluateResponse(
        reminder_id=reminder.id,
        time_status=timelogic.deadline_status(reminder, now),
        should_time_notify=timelogic.should_time_notify(reminder, now),
        location=LocationSignal(**signal),
    )
