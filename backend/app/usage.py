"""Spend guard for model calls.

Nebius Token Factory has no budget cap, so the backend enforces its own: a daily
call limit, a daily token limit and a per-minute throttle. When a limit is hit
the call is refused before it reaches Nebius, so nothing more is spent.

Every counter lives in the database and is updated with a conditional UPDATE, so
several workers sharing one database (Vercel runs many) can't both slip under a
limit. The per-minute throttle counts calls in the current clock minute.
"""

import threading
from datetime import datetime, timezone

from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app import config, db
from app.models import LlmUsageRow


class BudgetExceeded(Exception):
    """Raised before a model call when a spend limit has been reached."""


_lock = threading.Lock()


def _engine(eng):
    # Not init_db every time: on Postgres it locks tables, and this runs mid-request.
    eng = eng or db.engine
    db.ensure_initialized(eng)
    return eng


def _now() -> datetime:  # a function so tests can move the clock
    return datetime.now(timezone.utc)


def today() -> str:
    return _now().strftime("%Y-%m-%d")


def _ensure_row(s: Session, day: str) -> None:
    if s.get(LlmUsageRow, day) is None:
        try:
            s.add(LlmUsageRow(day=day))
            s.commit()
        except IntegrityError:  # another worker created today's row first
            s.rollback()


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


def _reserve_in_db(eng) -> None:
    """Count this call only if every limit still has room, each try in one statement."""
    now = _now()
    day, minute = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
    per_minute = config.LLM_CALLS_PER_MINUTE
    with Session(_engine(eng)) as s:
        _ensure_row(s, day)
        room = []
        if config.LLM_DAILY_CALL_LIMIT:
            room.append(LlmUsageRow.calls < config.LLM_DAILY_CALL_LIMIT)
        if config.LLM_DAILY_TOKEN_LIMIT:
            room.append(LlmUsageRow.tokens < config.LLM_DAILY_TOKEN_LIMIT)
        base = update(LlmUsageRow).where(LlmUsageRow.day == day, *room)
        if not per_minute:
            counted = s.execute(base.values(calls=LlmUsageRow.calls + 1)).rowcount
        else:
            counted = 0
            # Two rounds: if another worker starts the new minute between our two
            # statements, the first one succeeds on the second round.
            for _ in range(2):
                counted = s.execute(
                    base.where(LlmUsageRow.minute == minute, LlmUsageRow.minute_calls < per_minute)
                    .values(calls=LlmUsageRow.calls + 1, minute_calls=LlmUsageRow.minute_calls + 1)
                ).rowcount
                if counted:
                    break
                counted = s.execute(
                    base.where(or_(LlmUsageRow.minute.is_(None), LlmUsageRow.minute != minute))
                    .values(calls=LlmUsageRow.calls + 1, minute=minute, minute_calls=1)
                ).rowcount
                if counted:
                    break
        s.commit()
        if not counted:
            row = s.get(LlmUsageRow, day)
            s.refresh(row)
            if config.LLM_DAILY_CALL_LIMIT and row.calls >= config.LLM_DAILY_CALL_LIMIT:
                raise BudgetExceeded("daily model call limit reached")
            if config.LLM_DAILY_TOKEN_LIMIT and row.tokens >= config.LLM_DAILY_TOKEN_LIMIT:
                raise BudgetExceeded("daily model token limit reached")
            raise BudgetExceeded("too many model calls this minute")


def reserve_call(eng=None) -> None:
    """Check every limit, then count this call. Raises BudgetExceeded to refuse it."""
    with _lock:
        _reserve_in_db(eng)


def record_tokens(tokens: int, eng=None) -> None:
    if tokens <= 0:
        return
    with _lock, Session(_engine(eng)) as s:
        day = today()
        _ensure_row(s, day)
        s.execute(update(LlmUsageRow).where(LlmUsageRow.day == day).values(tokens=LlmUsageRow.tokens + tokens))
        s.commit()
