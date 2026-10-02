"""Decides whether a time-based reminder is relevant right now (Module 06).

Pure functions of a reminder and a clock, so they are easy to test and the
phone and the scoring engine (Module 08) can share one definition.

Statuses, in priority order:
  completed   the person finished it
  snoozed     snoozedUntil is still in the future
  none        no deadline (a pure location reminder)
  future      deadline is further away than the approaching window
  approaching deadline is within the window but not yet reached
  due         deadline has passed, within the overdue window
  expired     deadline passed longer ago than the overdue window

should_time_notify is true only when a reminder is due and has not already
been notified for it. Nudging at "approaching" is deliberately not done: the
phone schedules the exact-deadline notification, and an extra heads-up for
every reminder would be noise.
"""

from datetime import datetime, timedelta
from typing import Literal

from app import config
from app.models import Reminder

DeadlineStatus = Literal["completed", "snoozed", "none", "future", "approaching", "due", "expired"]


def _effective_time(r: Reminder, now: datetime) -> datetime | None:
    """When the reminder counts: its deadline, or the end of a snooze that has
    already finished (so a snoozed reminder comes back after the snooze)."""
    if r.deadline is None:
        return None
    if r.snoozed_until is not None and r.deadline < r.snoozed_until <= now:
        return r.snoozed_until
    return r.deadline


def window_status(r: Reminder, now: datetime) -> DeadlineStatus:
    """Where the deadline sits relative to now, ignoring completed and snoozed.

    Scoring uses this directly so its breakdown can still say "deadline within
    2 hours" for a reminder that is also snoozed or done.
    """
    when = _effective_time(r, now)
    if when is None:
        return "none"
    if when > now:
        if when - now <= timedelta(minutes=config.APPROACHING_WINDOW_MIN):
            return "approaching"
        return "future"
    if now - when <= timedelta(hours=config.OVERDUE_WINDOW_HOURS):
        return "due"
    return "expired"


def deadline_status(r: Reminder, now: datetime) -> DeadlineStatus:
    if r.completed:
        return "completed"
    if r.snoozed_until is not None and r.snoozed_until > now:
        return "snoozed"
    return window_status(r, now)


def should_time_notify(r: Reminder, now: datetime) -> bool:
    if deadline_status(r, now) != "due":
        return False
    when = _effective_time(r, now)
    # Notify once per "counting" moment: a later notification already covers it.
    return r.last_notified_at is None or r.last_notified_at < when
