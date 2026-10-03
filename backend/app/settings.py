"""User settings, and what they mean for the rest of the backend.

Everything here is read through `load()`, which merges the stored choices with
the server's own limits. A user can make privacy stricter than the server, never
looser, and a missing row simply means "all defaults".
"""

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session

from app import config
from app.models import QuietHours, Settings, SettingsRow, TimesOfDay

ROW_ID = "default"


@dataclass
class Prefs:
    timezone_mode: str = "auto"
    timezone: str | None = None
    quiet: tuple[time, time] | None = None
    times: dict = field(default_factory=lambda: dict(morning="09:00", afternoon="15:00", evening="18:00", tonight="20:00"))
    threshold: int = 60
    cooldown_min: int = 30
    radius_m: float = 150.0
    keep_transcripts: bool = True
    retention_days: int = 0  # 0 = keep until deleted


def notify_levels() -> dict[str, tuple[int, int]]:
    """(threshold, cooldown minutes) per level. "normal" is the server's own setting.

    Every level keeps the threshold above 55, the best score a reminder can reach
    inside its cooldown, so no level ever repeats a notification within it.
    "fewer" (75) needs place AND timing to line up: a place alone (60) won't do.
    """
    normal = (config.NOTIFY_THRESHOLD, config.NOTIFY_COOLDOWN_MIN)
    return {"fewer": (max(75, normal[0]), max(120, normal[1])), "normal": normal, "more": (normal[0], min(10, normal[1]))}


def _hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


def get_row(db: Session) -> SettingsRow:
    return db.get(SettingsRow, ROW_ID) or SettingsRow(id=ROW_ID)


def effective_retention(user_days: int | None) -> int:
    server = config.TRANSCRIPT_RETENTION_DAYS
    candidates = [d for d in (server, user_days) if d]
    return min(candidates) if candidates else 0


def load(db: Session) -> Prefs:
    row = get_row(db)
    threshold, cooldown = notify_levels().get(row.notify_level, notify_levels()["normal"])
    return Prefs(
        timezone_mode=row.timezone_mode,
        timezone=row.timezone,
        quiet=(_hhmm(row.quiet_start), _hhmm(row.quiet_end)) if row.quiet_start and row.quiet_end else None,
        times=dict(morning=row.morning, afternoon=row.afternoon, evening=row.evening, tonight=row.tonight),
        threshold=threshold,
        cooldown_min=cooldown,
        radius_m=row.near_radius_meters,
        keep_transcripts=config.STORE_TRANSCRIPTS and row.keep_transcripts,
        retention_days=effective_retention(row.delete_transcripts_after_days),
    )


def _valid(name: str | None) -> bool:
    if not name:
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def timezone_for(prefs: Prefs, phone_tz: str | None) -> str:
    """Manual mode: the chosen zone, always. Auto: the phone's zone, then the
    last zone the person chose, then the server default."""
    if prefs.timezone_mode == "manual" and _valid(prefs.timezone):
        return prefs.timezone
    for candidate in (phone_tz, prefs.timezone, config.DEFAULT_TIMEZONE):
        if _valid(candidate):
            return candidate
    return "UTC"


def quiet_until(prefs: Prefs, now: datetime, tz: ZoneInfo) -> datetime | None:
    """If `now` falls in quiet hours, when they end (aware). Otherwise None.

    Handles windows that cross midnight (23:00 to 07:00) and ones that don't
    (13:00 to 14:00). The end is computed in the person's zone, so a clock change
    overnight still ends quiet hours at 07:00 on the wall.
    """
    if not prefs.quiet:
        return None
    start, end = prefs.quiet
    local = now.astimezone(tz)
    t = local.time()
    inside = (start <= t < end) if start < end else (t >= start or t < end)
    if not inside:
        return None
    end_day = local.date() if t < end else local.date() + timedelta(days=1)
    return datetime(end_day.year, end_day.month, end_day.day, end.hour, end.minute, tzinfo=tz)


def to_api(row: SettingsRow) -> Settings:
    return Settings(
        timezone_mode=row.timezone_mode,
        timezone=row.timezone,
        quiet_hours=QuietHours(start=row.quiet_start, end=row.quiet_end) if row.quiet_start and row.quiet_end else None,
        times_of_day=TimesOfDay(morning=row.morning, afternoon=row.afternoon, evening=row.evening, tonight=row.tonight),
        notify_level=row.notify_level,
        near_radius_meters=row.near_radius_meters,
        keep_transcripts=row.keep_transcripts,
        delete_transcripts_after_days=row.delete_transcripts_after_days,
        server_keeps_transcripts=config.STORE_TRANSCRIPTS,
        server_retention_days=config.TRANSCRIPT_RETENTION_DAYS,
    )
