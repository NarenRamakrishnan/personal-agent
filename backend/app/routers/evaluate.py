from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from app import places, scoring, settings, timelogic
from app.parser import resolve_tz
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
from app.security import current_owner

router = APIRouter(tags=["evaluate"])


def _row_to_api(row: SavedPlaceRow) -> SavedPlace:
    return SavedPlace(name=row.name, latitude=row.latitude, longitude=row.longitude,
                      radius_meters=row.radius_meters)


@router.get("/saved-places", response_model=list[SavedPlace])
def list_saved_places(db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    query = select(SavedPlaceRow).where(SavedPlaceRow.owner == owner).order_by(SavedPlaceRow.name)
    return [_row_to_api(r) for r in db.exec(query)]


@router.put("/saved-places/{name}", response_model=SavedPlace)
def put_saved_place(name: str, body: SavedPlace, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    key = places.saved_place_name(name)
    if not key:
        raise HTTPException(status_code=422, detail="name is required")
    row = db.get(SavedPlaceRow, (owner, key)) or SavedPlaceRow(owner=owner, name=key, latitude=0, longitude=0)
    row.latitude, row.longitude, row.radius_meters = body.latitude, body.longitude, body.radius_meters
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_api(row)


@router.delete("/saved-places/{name}", status_code=204)
def delete_saved_place(name: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    row = db.get(SavedPlaceRow, (owner, places.saved_place_name(name)))
    if row is None:
        raise HTTPException(status_code=404, detail="Saved place not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post("/evaluate-reminder", response_model=EvaluateResponse, response_model_exclude_none=True)
def evaluate_reminder(body: EvaluateRequest, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """The time and location signals for one reminder (the scoring engine builds on these)."""
    if body.reminder_id is not None:
        row = db.get(ReminderRow, body.reminder_id)
        if row is None or row.owner != owner:
            raise HTTPException(status_code=404, detail="Reminder not found")
        try:
            reminder = row.to_api()
        except ValueError:
            raise HTTPException(status_code=422, detail="This reminder's saved data is invalid; fix it with PATCH")
    else:
        reminder = body.reminder
    now = body.context.now or utcnow()

    def lookup(name):
        r = db.get(SavedPlaceRow, (owner, name))
        return (r.latitude, r.longitude, r.radius_meters) if r else None

    prefs = settings.load(db, owner)
    tz = resolve_tz(settings.timezone_for(prefs, body.context.timezone))
    signal = places.evaluate_location(reminder, body.context, lookup, prefs.radius_m)
    decision = scoring.decide(reminder, now, signal["applicable"] and signal["matched"], tz, prefs)
    return EvaluateResponse(
        reminder_id=reminder.id,
        time_status=timelogic.deadline_status(reminder, now),
        should_time_notify=timelogic.should_time_notify(reminder, now),
        location=LocationSignal(**signal),
        **decision,
    )
