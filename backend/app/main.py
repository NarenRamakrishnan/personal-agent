import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.db import init_db
from app.routers import parse, reminders, usage

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
    yield


app = FastAPI(title="Commitment Tracker API", lifespan=lifespan)

# Expo web runs on another origin in dev. Native apps don't need CORS at all.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(reminders.router)
app.include_router(parse.router)
app.include_router(usage.router)


@app.get("/health")
def health():
    return {"status": "ok"}
