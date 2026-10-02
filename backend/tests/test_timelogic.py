from datetime import datetime, timedelta, timezone

import pytest

from app import config
from app.models import Reminder
from app.timelogic import deadline_status, should_time_notify

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


def rem(**kw):
    base = dict(id="r", title="t", trigger_type="time", created_at=NOW - timedelta(days=1))
    base.update(kw)
    return Reminder(**base)


def mins(m):
    return NOW + timedelta(minutes=m)


@pytest.mark.parametrize("kw, status", [
    (dict(deadline=mins(500)), "future"),
    (dict(deadline=mins(121)), "future"),
    (dict(deadline=mins(120)), "approaching"),   # boundary: the window is inclusive
    (dict(deadline=mins(1)), "approaching"),
    (dict(deadline=mins(0)), "due"),              # exactly now counts as due
    (dict(deadline=mins(-1)), "due"),
    (dict(deadline=mins(-60 * 24)), "due"),       # boundary: 24h overdue still due
    (dict(deadline=mins(-60 * 24 - 1)), "expired"),
    (dict(), "none"),
    (dict(deadline=mins(-10), completed=True), "completed"),
    (dict(deadline=mins(500), completed=True), "completed"),
    (dict(deadline=mins(-10), snoozed_until=mins(30)), "snoozed"),
    (dict(deadline=mins(500), snoozed_until=mins(30)), "snoozed"),
])
def test_deadline_status(kw, status):
    assert deadline_status(rem(**kw), NOW) == status


def test_completed_beats_snoozed():
    assert deadline_status(rem(deadline=mins(-5), completed=True, snoozed_until=mins(30)), NOW) == "completed"


@pytest.mark.parametrize("kw, expected", [
    (dict(deadline=mins(-1)), True),                                  # due, never notified
    (dict(deadline=mins(0)), True),
    (dict(deadline=mins(5)), False),                                  # approaching: no nudge
    (dict(deadline=mins(500)), False),                                # future
    (dict(), False),                                                  # no deadline
    (dict(deadline=mins(-1), completed=True), False),
    (dict(deadline=mins(-1), snoozed_until=mins(10)), False),         # still snoozed
    (dict(deadline=mins(-60 * 30)), False),                           # expired
    (dict(deadline=mins(-10), last_notified_at=mins(-5)), False),     # already told them
    (dict(deadline=mins(-10), last_notified_at=mins(-20)), True),     # told before it was due
])
def test_should_time_notify(kw, expected):
    assert should_time_notify(rem(**kw), NOW) is expected


def test_snooze_ending_brings_the_reminder_back_once():
    r = rem(deadline=mins(-60), last_notified_at=mins(-59), snoozed_until=mins(-1))
    assert deadline_status(r, NOW) == "due"
    assert should_time_notify(r, NOW) is True       # snooze finished, not yet re-notified
    notified = rem(deadline=mins(-60), last_notified_at=mins(0), snoozed_until=mins(-1))
    assert should_time_notify(notified, NOW) is False


def test_a_snooze_that_ends_long_after_the_overdue_window_counts_from_the_snooze_end():
    # deadline 3 days ago, snoozed until 1 hour ago: it is due again, not expired
    r = rem(deadline=mins(-60 * 72), snoozed_until=mins(-60))
    assert deadline_status(r, NOW) == "due"


def test_location_only_reminder_is_never_time_notified():
    r = rem(trigger_type="location", location={"type": "category", "category": "pharmacy"})
    assert deadline_status(r, NOW) == "none" and should_time_notify(r, NOW) is False


def test_window_is_configurable(monkeypatch):
    monkeypatch.setattr(config, "APPROACHING_WINDOW_MIN", 10)
    assert deadline_status(rem(deadline=mins(60)), NOW) == "future"
    assert deadline_status(rem(deadline=mins(9)), NOW) == "approaching"


def test_notified_exactly_at_the_deadline_is_not_notified_again():
    # The phone fires its local notification at the exact deadline, so this is
    # the normal case and must not trigger a second notification.
    r = rem(deadline=mins(-10), last_notified_at=mins(-10))
    assert should_time_notify(r, NOW) is False
