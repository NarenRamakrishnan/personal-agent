import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

# Defaults from Nebius's own cookbook (nebius/token-factory-cookbook, nemotron3-super-120B.md).
NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY", "")
NEBIUS_BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.us-central1.nebius.com/v1/")
NEBIUS_MODEL = os.getenv("NEBIUS_MODEL", "nvidia/nemotron-3-super-120b-a12b")

# "auto" uses Nebius when a key is set and the mock parser otherwise.
PARSER_MODE = os.getenv("PARSER_MODE", "auto")

# Local SQLite for now. Point this at Supabase Postgres when we deploy.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'commitments.db'}")

DEFAULT_TIMEZONE = os.getenv("DEFAULT_TIMEZONE", "America/New_York")


def parser_mode() -> str:
    if PARSER_MODE == "auto":
        return "nebius" if NEBIUS_API_KEY else "mock"
    return PARSER_MODE


# Optional shared secret. Off by default so local dev and the mobile app work
# unchanged. Set it before deploying anywhere public, then have the app send
# it as an `X-API-Key` header.
API_KEY = os.getenv("API_KEY", "")


# Spend guard: our own hard stop, because Nebius Token Factory has no budget cap.
# Counted per UTC day in the database. Set a limit to 0 to disable that check.
LLM_DAILY_CALL_LIMIT = int(os.getenv("LLM_DAILY_CALL_LIMIT", "400"))
LLM_DAILY_TOKEN_LIMIT = int(os.getenv("LLM_DAILY_TOKEN_LIMIT", "400000"))
LLM_CALLS_PER_MINUTE = int(os.getenv("LLM_CALLS_PER_MINUTE", "60"))


# Listening sessions (Module 04). A session ends when the app says so, after this
# many seconds with no chunks, or at the hard maximum. Checked lazily on read.
SESSION_SILENCE_TIMEOUT_S = int(os.getenv("SESSION_SILENCE_TIMEOUT_S", "120"))
SESSION_MAX_DURATION_S = int(os.getenv("SESSION_MAX_DURATION_S", "1800"))


# Time logic (Module 06).
APPROACHING_WINDOW_MIN = int(os.getenv("APPROACHING_WINDOW_MIN", "120"))  # matches the "+30, deadline < 2h" scoring rule
OVERDUE_WINDOW_HOURS = int(os.getenv("OVERDUE_WINDOW_HOURS", "24"))  # past this, a missed reminder is expired


# Scoring (Module 08). 60 is derived, not guessed: it is the lowest threshold where a
# nearby never-notified reminder fires (50+10) while even the best case inside the
# cooldown (50+30+15-40 = 55) stays quiet.
NOTIFY_THRESHOLD = int(os.getenv("NOTIFY_THRESHOLD", "60"))
NOTIFY_COOLDOWN_MIN = int(os.getenv("NOTIFY_COOLDOWN_MIN", "30"))
