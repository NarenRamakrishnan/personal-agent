import secrets

from fastapi import Header, HTTPException

from app import config


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not config.API_KEY:
        return
    supplied = (x_api_key or "").encode("utf-8")
    if not supplied or not secrets.compare_digest(supplied, config.API_KEY.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
