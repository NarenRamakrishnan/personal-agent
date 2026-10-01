import secrets

from fastapi import Header, HTTPException

from app import config


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not config.API_KEY:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, config.API_KEY):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
