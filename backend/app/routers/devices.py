import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import text
from sqlmodel import Session

from app import config
from app.db import get_session
from app.models import DeviceToken
from app.security import register_device

router = APIRouter(tags=["devices"])


@router.post("/devices", response_model=DeviceToken, status_code=201)
def create_device(db: Session = Depends(get_session)):
    """A phone's first call: get its own token. Keep it on the phone; it's shown once and
    only its hash is stored. Then send "Authorization: Bearer <token>" on every request."""
    device, token = register_device(db)
    return DeviceToken(device_id=device.id, token=token)


@router.get("/cron/keep-alive")
def keep_alive(authorization: str | None = Header(default=None), db: Session = Depends(get_session)):
    """Touch the database once a day (Vercel Cron), so a free Supabase project that sees
    no other use isn't paused before judges try the app. Vercel sends CRON_SECRET."""
    expected = f"Bearer {config.CRON_SECRET}"
    if not config.CRON_SECRET or not secrets.compare_digest((authorization or "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Not allowed")
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
