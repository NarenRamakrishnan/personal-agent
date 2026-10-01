"""Spend guard for model calls.

Nebius Token Factory has no budget cap, so the backend enforces its own: a daily
call limit, a daily token limit and a per-minute throttle. When a limit is hit
the call is refused before it reaches Nebius, so nothing more is spent.
"""

import threading
import time
from collections import deque
from datetime import datetime, timezone

from sqlmodel import Session

from app import config, db
from app.models import LlmUsageRow


class BudgetExceeded(Exception):
    """Raised before a model call when a spend limit has been reached."""


_recent: deque[float] = deque()
_lock = threading.Lock()
_ready: set[int] = set()


def _engine(eng):
    eng = eng or db.engine
    if id(eng) not in _ready:
        db.init_db(eng)
        _ready.add(id(eng))
    return eng


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def snapshot(eng=None) -> dict:
    with Session(_engine(eng)) as s:
        row = s.get(LlmUsageRow, today())
        calls, tokens = (row.calls, row.tokens) if row else (0, 0)
    return {
        "day": today(),
        "calls": calls,
        "tokens": tokens,
        "callLimit": config.LLM_DAILY_CALL_LIMIT,
        "tokenLimit": config.LLM_DAILY_TOKEN_LIMIT,
        "callsPerMinuteLimit": config.LLM_CALLS_PER_MINUTE,
    }


def reserve_call(eng=None) -> None:
    """Check every limit, then count this call. Raises BudgetExceeded to refuse it."""
    with _lock:
        per_minute = config.LLM_CALLS_PER_MINUTE
        if per_minute:
            now = time.monotonic()
            while _recent and now - _recent[0] > 60:
                _recent.popleft()
            if len(_recent) >= per_minute:
                raise BudgetExceeded("too many model calls this minute")
        with Session(_engine(eng)) as s:
            row = s.get(LlmUsageRow, today()) or LlmUsageRow(day=today())
            if config.LLM_DAILY_CALL_LIMIT and row.calls >= config.LLM_DAILY_CALL_LIMIT:
                raise BudgetExceeded("daily model call limit reached")
            if config.LLM_DAILY_TOKEN_LIMIT and row.tokens >= config.LLM_DAILY_TOKEN_LIMIT:
                raise BudgetExceeded("daily model token limit reached")
            row.calls += 1
            s.add(row)
            s.commit()
        _recent.append(time.monotonic())


def record_tokens(tokens: int, eng=None) -> None:
    if tokens <= 0:
        return
    with _lock, Session(_engine(eng)) as s:
        row = s.get(LlmUsageRow, today()) or LlmUsageRow(day=today())
        row.tokens += tokens
        s.add(row)
        s.commit()


def reset_throttle() -> None:
    with _lock:
        _recent.clear()
