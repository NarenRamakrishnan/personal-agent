import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app import retention
from app.db import engine, init_db
from sqlmodel import Session

from app.routers import actions, devices, evaluate, parse, privacy, reminders, sessions, settings, usage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def check_deploy_safety() -> None:
    """Refuse to fall back to the mock parser on a real database just because the key
    is missing. (Access needs no check here: off local SQLite every request needs a
    device token or the API key, see security.current_owner.)"""
    if not config.DATABASE_URL.startswith("sqlite") and config.PARSER_MODE == "auto" and config.parser_mode() == "mock":
        # auto falls back to the mock parser without a key, which turns every chunk the
        # phone hears into a reminder. Locally that's the point; deployed it's a mistake.
        raise RuntimeError(
            "NEBIUS_API_KEY is not set, so the parser would run in mock mode on a real database. "
            "Set NEBIUS_API_KEY, or PARSER_MODE=mock if that is really what you want."
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    check_deploy_safety()
    init_db()
    with Session(engine) as db:
        retention.purge_expired(db)
    yield


app = FastAPI(title="Commitment Tracker API", lifespan=lifespan)

# Expo web runs on another origin in dev. Native apps don't need CORS at all.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

log = logging.getLogger(__name__)


@app.middleware("http")
async def log_safe_errors(request: Request, call_next):
    """Never let an exception message into the logs: validation errors and model
    replies can contain what the person said. Log only the type and the route."""
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001 - this is the last line of defence
        log.error("unhandled %s on %s %s", type(e).__name__, request.method, request.url.path)
        return JSONResponse({"detail": "Internal error"}, status_code=500)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    """422 with where and why, but never the offending value: it may be what the
    person said, and a non-finite number in it (Infinity) can't be sent back as JSON."""
    errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


app.include_router(devices.router)
app.include_router(reminders.router)
app.include_router(parse.router)
app.include_router(actions.router)
app.include_router(evaluate.router)
app.include_router(sessions.router)
app.include_router(usage.router)
app.include_router(privacy.router)
app.include_router(settings.router)


@app.get("/health")
def health():
    return {"status": "ok"}
