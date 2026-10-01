import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Defaults from Nebius's own cookbook (nebius/token-factory-cookbook, nemotron3-super-120B.md).
NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY", "")
NEBIUS_BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.us-central1.nebius.com/v1/")
NEBIUS_MODEL = os.getenv("NEBIUS_MODEL", "nvidia/nemotron-3-super-120b-a12b")

# "auto" uses Nebius when a key is set and the mock parser otherwise.
PARSER_MODE = os.getenv("PARSER_MODE", "auto")

# Local SQLite for now. Point this at Supabase Postgres when we deploy.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./commitments.db")

DEFAULT_TIMEZONE = os.getenv("DEFAULT_TIMEZONE", "America/New_York")


def parser_mode() -> str:
    if PARSER_MODE == "auto":
        return "nebius" if NEBIUS_API_KEY else "mock"
    return PARSER_MODE
