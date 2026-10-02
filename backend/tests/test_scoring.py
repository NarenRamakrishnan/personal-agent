"""24+ scenarios for the context engine. Expected scores are worked out by hand
from the rules (50 nearby, 30 deadline<2h, 15 nearby+today, 10 never notified,
-40 recent notification, -100 completed or snoozed, threshold 60), not copied
from the code's output."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app import config, scoring
from app.models import Location, Reminder

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
UTC = ZoneInfo("UTC")


def m(minutes):
    return NOW + timedelta(minutes=minutes)


def rem(deadline=None, notified_ago=None, completed=False, snoozed=None, trigger="location"):
    return Reminder(
        id="r", title="t", trigger_type=trigger, created_at=m(-9999), completed=completed,
        location=Location(type="category", category="grocery_store") if trigger != "time" else None,
        deadline=m(deadline) if deadline is not None else None,
        last_notified_at=m(-notified_ago) if notified_ago is not None else None,
        snoozed_until=m(snoozed) if snoozed is not None else None,
    )


# (name, matched, reminder kwargs, expected score, expected notify, expected decided_by)
SCENARIOS = [
    ("1 nearby, never notified",                    True,  dict(), 60, True, "context"),
    ("2 nearby, notified 10 min ago",               True,  dict(notified_ago=10), 10, False, None),
    ("3 nearby, notified 2h ago",                   True,  dict(notified_ago=120), 50, False, None),
    ("4 not nearby, never notified",                False, dict(), 10, False, None),
    ("5 nearby, completed",                         True,  dict(completed=True), -40, False, None),
    ("6 nearby, snoozed",                           True,  dict(snoozed=30), -40, False, None),
    ("7 nearby, due in 1h, never",                  True,  dict(deadline=60), 105, True, "context"),
    ("8 nearby, due in 1h, notified 10 min ago",    True,  dict(deadline=60, notified_ago=10), 55, False, None),
    ("9 nearby, deadline tomorrow, never",          True,  dict(deadline=24 * 60), 60, True, "context"),
    ("10 nearby, deadline tomorrow, notified 3h",   True,  dict(deadline=24 * 60, notified_ago=180), 50, False, None),
    ("11 nearby, deadline in 5h today, notified 3h", True, dict(deadline=300, notified_ago=180), 65, True, "context"),
    ("12 not nearby, due in 1h, never",             False, dict(deadline=60), 40, False, None),
    ("13 not nearby, deadline 5 min ago, never",    False, dict(deadline=-5), 40, True, "time"),
    ("14 nearby, just notified at the deadline",    True,  dict(deadline=-5, notified_ago=5), 55, False, None),
    ("15 nearby, deadline expired 3 days ago",      True,  dict(deadline=-72 * 60), 60, True, "context"),
    ("16 time-only, deadline passed, never",        False, dict(deadline=-5, trigger="time"), 40, True, "time"),
    ("17 time-only, due in 1h",                     False, dict(deadline=60, trigger="time"), 40, False, None),
    ("18 time-only, deadline tomorrow",             False, dict(deadline=24 * 60, trigger="time"), 10, False, None),
    ("19 time-only, passed but completed",          False, dict(deadline=-5, trigger="time", completed=True), -60, False, None),
    ("20 nearby, deadline 6h ago same day, never",  True,  dict(deadline=-360), 105, True, "time"),
    ("21 nearby, due in 1h, snoozed",               True,  dict(deadline=60, snoozed=10), 5, False, None),
    ("22 nearby, notified 29 min ago (cooldown)",   True,  dict(notified_ago=29), 10, False, None),
    ("23 nearby, notified 30 min ago (cooldown over)", True, dict(notified_ago=30), 50, False, None),
]


@pytest.mark.parametrize("name, matched, kw, score, notify, by", SCENARIOS, ids=[s[0] for s in SCENARIOS])
def test_scenario(name, matched, kw, score, notify, by):
    d = scoring.decide(rem(**kw), NOW, matched, UTC)
    assert (d["score"], d["notify"], d["decided_by"]) == (score, notify, by)


def test_deadline_today_follows_the_persons_timezone():
    now = datetime(2026, 10, 2, 3, 0, tzinfo=timezone.utc)   # 23:00 on Oct 1 in New York
    r = Reminder(id="r", title="t", trigger_type="location", created_at=now - timedelta(days=1),
                 location=Location(type="category", category="gym"),
                 deadline=datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc))  # 08:00 Oct 2 in New York
    assert scoring.score_reminder(r, now, True, ZoneInfo("UTC")).total == 75               # 50+15+10
    assert scoring.score_reminder(r, now, True, ZoneInfo("America/New_York")).total == 60  # 50+10, not today


def test_reasons_explain_the_score():
    s = scoring.score_reminder(rem(deadline=60), NOW, True, UTC)
    assert [r["points"] for r in s.reasons] == [50, 30, 15, 10]
    assert sum(r["points"] for r in s.reasons) == s.total == 105


def test_nothing_that_is_completed_or_snoozed_ever_notifies():
    """Brute force: the -100 must beat every combination of the positive points."""
    for matched in (True, False):
        for deadline in (None, -3000, -60, 0, 60, 300, 3000):
            for notified in (None, 5, 31, 200):
                for kw in (dict(completed=True), dict(snoozed=45)):
                    d = scoring.decide(rem(deadline=deadline, notified_ago=notified, **kw), NOW, matched, UTC)
                    assert d["notify"] is False, (matched, deadline, notified, kw)


def test_the_cooldown_always_beats_the_best_possible_case():
    """Derivation of the threshold: nearby + <2h + today, notified a moment ago."""
    best_with_cooldown = scoring.score_reminder(rem(deadline=60, notified_ago=1), NOW, True, UTC).total
    best_first_time = scoring.score_reminder(rem(), NOW, True, UTC).total
    assert best_with_cooldown < config.NOTIFY_THRESHOLD <= best_first_time


def test_threshold_is_configurable(monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_THRESHOLD", 100)
    assert scoring.decide(rem(), NOW, True, UTC)["notify"] is False


def test_evaluate_endpoint_returns_the_decision(client):
    client.post("/reminders", json={"id": "eggs", "title": "Buy eggs", "triggerType": "location",
                                    "location": {"type": "category", "category": "grocery_store"}})
    ctx = {"now": NOW.isoformat(), "nearbyPlaces": [{"name": "Stop & Shop", "types": ["supermarket"], "distanceMeters": 40}]}
    body = client.post("/evaluate-reminder", json={"reminderId": "eggs", "context": ctx}).json()
    assert body["score"] == 60 and body["notify"] is True and body["decidedBy"] == "context"
    assert [r["label"] for r in body["reasons"]] == ["relevant place is nearby", "never notified before"]
    away = client.post("/evaluate-reminder", json={"reminderId": "eggs", "context": {"now": NOW.isoformat()}}).json()
    assert away["notify"] is False and away["score"] == 10
