import os
from pathlib import Path

from dotenv import load_dotenv

def _env_bool(name: str, default: bool) -> bool:
    """A true/false setting. An unrecognised spelling stops startup: a privacy
    switch that silently ignores "off" is worse than a crash."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "y", "on"):
        return True
    if value in ("0", "false", "no", "n", "off", "disabled"):
        return False
    raise ValueError(f"{name} must be true or false, got {raw!r}")


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from None
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value

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
LLM_DAILY_CALL_LIMIT = _env_int("LLM_DAILY_CALL_LIMIT", 400)
LLM_DAILY_TOKEN_LIMIT = _env_int("LLM_DAILY_TOKEN_LIMIT", 400000)
LLM_CALLS_PER_MINUTE = _env_int("LLM_CALLS_PER_MINUTE", 60)
# Per device (POST /devices): model calls one phone may make in a UTC day, so no single
# device can use up the daily limit above, and new devices allowed per hour across
# everyone, so minting devices can't get around that.
DEVICE_DAILY_CALL_LIMIT = _env_int("DEVICE_DAILY_CALL_LIMIT", 100)
DEVICE_SIGNUPS_PER_HOUR = _env_int("DEVICE_SIGNUPS_PER_HOUR", 30)
# Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" to /cron/keep-alive.
CRON_SECRET = os.getenv("CRON_SECRET", "")


# Listening sessions (Module 04). A session ends when the app says so, after this
# many seconds with no chunks, or at the hard maximum. Checked lazily on read.
# 10 minutes: a pause that long is normal in a conversation the phone is listening to,
# and a shorter one splits one conversation into several sessions to review.
SESSION_SILENCE_TIMEOUT_S = _env_int("SESSION_SILENCE_TIMEOUT_S", 600)
SESSION_MAX_DURATION_S = _env_int("SESSION_MAX_DURATION_S", 1800)


# Time logic (Module 06).
APPROACHING_WINDOW_MIN = _env_int("APPROACHING_WINDOW_MIN", 120)  # matches the "+30, deadline < 2h" scoring rule
OVERDUE_WINDOW_HOURS = _env_int("OVERDUE_WINDOW_HOURS", 24)  # past this, a missed reminder is expired


# Scoring (Module 08). 60 is derived, not guessed: it is the lowest threshold where a
# nearby never-notified reminder fires (50+10) while even the best case inside the
# cooldown (50+30+15-40 = 55) stays quiet.
NOTIFY_THRESHOLD = _env_int("NOTIFY_THRESHOLD", 60)
NOTIFY_COOLDOWN_MIN = _env_int("NOTIFY_COOLDOWN_MIN", 30)


# Privacy and reliability (Module 10).
# The backend never receives or stores audio, only text. These control the text.
STORE_TRANSCRIPTS = _env_bool("STORE_TRANSCRIPTS", True)
TRANSCRIPT_RETENTION_DAYS = _env_int("TRANSCRIPT_RETENTION_DAYS", 30)  # 0 keeps them until deleted
PENDING_RETRY_LIMIT = _env_int("PENDING_RETRY_LIMIT", 10)
# Seconds any one request may spend on model calls. The phone gives up on a request
# after 28 s (mobile/src/api/client.ts) and Vercel stops the function at 30 s
# (vercel.json), so this stays under both: past it a typed parse keeps the person's
# words, a chunk is queued and retries wait for the next pass. Nemotron's thinking
# makes a live parse of a whole talk take 7-12 s, so 12 s timed out too often.
REQUEST_BUDGET_S = _env_int("REQUEST_BUDGET_S", 24, minimum=1)
# A queued chunk the model answers but can't parse this many times is kept as a
# plain reminder for review instead. Outages never count towards it.
PENDING_MAX_ATTEMPTS = _env_int("PENDING_MAX_ATTEMPTS", 3, minimum=1)
LATE_CHUNK_TOLERANCE_S = _env_int("LATE_CHUNK_TOLERANCE_S", 5)
