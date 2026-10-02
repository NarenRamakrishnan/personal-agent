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

from app.routers import actions, evaluate, parse, privacy, reminders, sessions, usage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not config.DATABASE_URL.startswith("sqlite") and not config.API_KEY:
        logging.getLogger(__name__).critical(
            "API_KEY is not set but the database is not local SQLite: "
            "anyone who can reach this server can read, change and delete reminders "
            "and spend Nebius credits."
        )
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


app.include_router(reminders.router)
app.include_router(parse.router)
app.include_router(actions.router)
app.include_router(evaluate.router)
app.include_router(sessions.router)
app.include_router(usage.router)
app.include_router(privacy.router)


@app.get("/health")
def health():
    return {"status": "ok"}
