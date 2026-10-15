"""Who is calling, and so whose data a request may touch.

Each phone asks once for its own token (POST /devices) and sends it as
"Authorization: Bearer <token>". Its reminders, sessions, places, drafts and settings
are then its own: one judge can't see or change another's, and one leaked token
exposes one device. Only a SHA-256 of each token is stored.

The older shared X-API-Key still works and maps every holder to one shared owner.
With no API_KEY set on local SQLite, no credentials are needed (tests, local dev).
"""

import hashlib
import secrets
from datetime import timedelta

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, func, select

from app import config
from app.db import get_session
from app.models import SHARED_OWNER, DeviceRow, utcnow


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _open_locally() -> bool:
    # check_deploy_safety refuses to start this way on a real database.
    return not config.API_KEY and config.DATABASE_URL.startswith("sqlite")


def current_owner(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_session),
) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        device = db.exec(select(DeviceRow).where(DeviceRow.token_hash == hash_token(token.strip()))).first()
        if device is None or device.revoked:
            raise HTTPException(status_code=401, detail="Unknown or revoked device token")
        return device.id
    if config.API_KEY and x_api_key is not None:
        if secrets.compare_digest(x_api_key.encode("utf-8"), config.API_KEY.encode("utf-8")):
            return SHARED_OWNER
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
    if _open_locally():
        return SHARED_OWNER
    raise HTTPException(status_code=401, detail="Send a device token (POST /devices) or the API key")


def register_device(db: Session) -> tuple[DeviceRow, str]:
    """Make a device and its token. Capped per hour across everyone, so a script can't
    mint devices to get around each device's daily model-call limit."""
    since = utcnow() - timedelta(hours=1)
    recent = db.exec(select(func.count()).select_from(DeviceRow).where(DeviceRow.created_at >= since)).one()
    if recent >= config.DEVICE_SIGNUPS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many new devices right now. Try again in an hour.")
    token = secrets.token_urlsafe(32)
    device = DeviceRow(token_hash=hash_token(token))
    db.add(device)
    db.commit()
    db.refresh(device)
    return device, token
