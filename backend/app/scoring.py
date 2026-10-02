"""Context scoring (Module 08): should we interrupt the person right now?

Points (from the execution plan):
  +50  the reminder's place is where the person is now
  +30  the deadline is within 2 hours (or just passed)
  +15  a relevant place AND the deadline is today
  +10  never notified before
  -40  notified within the cooldown
  -100 completed, or snoozed

The score covers context-driven notifications (a location event fired). A
time-only reminder tops out at 40, below the threshold, on purpose: those fire
through timelogic.should_time_notify at the exact deadline, so the phone is
not nudged twice. The final decision is "time says yes OR score >= threshold".
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import config, timelogic
from app.models import Reminder


@dataclass
class Score:
    total: int = 0
    reasons: list[dict] = field(default_factory=list)

    def add(self, label: str, points: int) -> None:
        self.total += points
        self.reasons.append({"label": label, "points": points})


def score_reminder(reminder: Reminder, now: datetime, location_matched: bool, tz: ZoneInfo) -> Score:
    s = Score()
    status = timelogic.deadline_status(reminder, now)
    proximity = timelogic.window_status(reminder, now)  # deadline facts, even if snoozed or done

    if location_matched:
        s.add("relevant place is nearby", 50)
    if proximity in ("approaching", "due"):
        s.add("deadline within 2 hours or just passed", 30)
    if (
        location_matched
        and reminder.deadline is not None
        and reminder.deadline.astimezone(tz).date() == now.astimezone(tz).date()
    ):
        s.add("relevant place and deadline is today", 15)
    if reminder.last_notified_at is None:
        s.add("never notified before", 10)
    elif now - reminder.last_notified_at < timedelta(minutes=config.NOTIFY_COOLDOWN_MIN):
        s.add("notified recently", -40)
    if reminder.completed:
        s.add("already completed", -100)
    elif status == "snoozed":
        s.add("snoozed", -100)
    return s


def decide(reminder: Reminder, now: datetime, location_matched: bool, tz: ZoneInfo) -> dict:
    score = score_reminder(reminder, now, location_matched, tz)
    by_time = timelogic.should_time_notify(reminder, now)
    by_context = score.total >= config.NOTIFY_THRESHOLD
    return {
        "score": score.total,
        "reasons": score.reasons,
        "notify": by_time or by_context,
        "decided_by": "time" if by_time else ("context" if by_context else None),
    }
