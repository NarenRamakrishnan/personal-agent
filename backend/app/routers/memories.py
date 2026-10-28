from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from app import emailer, memory
from app.db import get_session
from app.models import Memory, MemoryCreate, MemoryRow, MemoryUpdate, utcnow
from app.security import current_owner

router = APIRouter(prefix="/memories", tags=["memories"])


def get_or_404(db: Session, memory_id: str, owner: str) -> MemoryRow:
    row = db.get(MemoryRow, memory_id)
    if row is None or row.owner != owner:  # another device's memory looks like none
        raise HTTPException(status_code=404, detail="Memory not found")
    return row


@router.get("", response_model=list[Memory], response_model_exclude_none=True)
def list_memories(db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    rows = db.exec(select(MemoryRow).where(MemoryRow.owner == owner).order_by(MemoryRow.kind, MemoryRow.label, MemoryRow.id))
    return [r.to_api() for r in rows]


@router.post("", response_model=Memory, response_model_exclude_none=True, status_code=201)
def add_memory(body: MemoryCreate, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    email = emailer._clean(body.email, 320)
    if email and not emailer.EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    key = memory.key_for(body.label)
    if not key:
        raise HTTPException(status_code=422, detail="Give it a name")
    fact = memory.Learned(body.kind, key, body.label.strip(), alias=body.alias, email=email,
                          place_name=body.place_name, place_type=body.place_type or ("place" if body.kind == "place" else None))
    (row,) = memory.remember(db, owner, [fact], session_id=None)
    db.commit()
    db.refresh(row)
    return row.to_api()


@router.patch("/{memory_id}", response_model=Memory, response_model_exclude_none=True)
def update_memory(memory_id: str, body: MemoryUpdate, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    """The person correcting what Heedly remembers: a name, an email, a usual place."""
    row = get_or_404(db, memory_id, owner)
    changes = body.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = emailer._clean(changes["email"], 320)
        if changes["email"] and not emailer.EMAIL_RE.match(changes["email"]):
            raise HTTPException(status_code=422, detail="Enter a valid email address")
        if row.kind != "person":
            raise HTTPException(status_code=422, detail="Only a person has an email")
    if "place_name" in changes and row.kind != "place":
        raise HTTPException(status_code=422, detail="Only a place memory has a place")
    for required in ("label", "place_name"):
        if changes.get(required, "keep") is None:
            changes.pop(required)
    if "label" in changes:
        key = memory.key_for(changes["label"])
        clash = db.exec(select(MemoryRow).where(MemoryRow.owner == owner, MemoryRow.kind == row.kind,
                                                MemoryRow.key == key, MemoryRow.id != row.id)).first()
        if not key or clash is not None:
            raise HTTPException(status_code=409, detail="Heedly already remembers something by that name")
        row.key = key
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_api()


@router.delete("/{memory_id}", status_code=204)
def forget(memory_id: str, db: Session = Depends(get_session), owner: str = Depends(current_owner)):
    db.delete(get_or_404(db, memory_id, owner))
    db.commit()
    return Response(status_code=204)
