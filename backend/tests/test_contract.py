"""Checks the API against Naren's real TypeScript types.

Reads ../mobile/src/types/reminder.ts, so if the phone's types change and the
backend doesn't follow, this fails instead of the app breaking on a device.
"""

import re
from pathlib import Path

import pytest

TS = Path(__file__).resolve().parents[2] / "mobile" / "src" / "types" / "reminder.ts"
pytestmark = pytest.mark.skipif(not TS.exists(), reason="mobile/ types not found")


def block(name):
    m = re.search(rf"export type {name} = \{{(.*?)\n\}};", TS.read_text(), re.S)
    assert m, f"type {name} not found in reminder.ts"
    return m.group(1)


def keys(name, required_only=False):
    pattern = r"^\s+(\w+):" if required_only else r"^\s+(\w+)\??:"
    return set(re.findall(pattern, block(name), re.M))


def union(text):
    return set(re.findall(r'"([^"]+)"', text))


def trigger_values():
    m = re.search(r"export type ReminderTriggerType =(.*?);", TS.read_text(), re.S)
    return union(m.group(1))


def location_type_values():
    line = re.search(r"^\s+type:(.*?);", block("ReminderLocation"), re.M).group(1)
    return union(line)


FULL = {
    "id": "c1", "title": "Return books", "description": "d", "createdAt": "2026-10-01T10:00:00Z",
    "deadline": "2026-10-02T17:00:00Z", "triggerType": "time_and_location", "completed": False,
    "lastNotifiedAt": "2026-10-01T11:00:00Z", "snoozedUntil": "2026-10-01T12:00:00Z",
    "location": {"type": "category", "name": "Library", "category": "grocery_store",
                 "latitude": 42.39, "longitude": -72.52, "radiusMeters": 150},
}


def test_reminder_responses_use_only_declared_keys_and_include_required_ones(client):
    created = client.post("/reminders", json=FULL).json()
    listed = client.get("/reminders").json()[0]
    for body in (created, listed):
        extra = set(body) - keys("Reminder") - {"sessionId", "sourceText"}  # backend-only extras
        assert not extra, f"API returns keys the phone type lacks: {extra}"
        assert keys("Reminder", required_only=True) <= set(body)
        assert set(body["location"]) <= keys("ReminderLocation")
        assert body["triggerType"] in trigger_values()
        assert body["location"]["type"] in location_type_values()


def test_the_phone_can_send_every_field_it_declares(client):
    # Everything in the phone's Reminder type must be accepted and echoed back.
    body = client.post("/reminders", json=FULL).json()
    for k in keys("Reminder"):
        assert body.get(k) == FULL[k], k


def test_parse_response_matches_ParsedReminder(client, monkeypatch):
    from app.models import Location, ReminderCreate

    c = ReminderCreate(
        title="Buy milk", trigger_type="time_and_location",
        deadline="2026-10-02T17:00:00Z",
        location=Location(type="category", category="grocery_store"),
    )
    monkeypatch.setattr("app.parser.parse", lambda *a, **k: [c])
    body = client.post("/parse", json={"text": "x"}).json()
    assert set(body) <= keys("ParsedReminder") | {"additional"}
    assert keys("ParsedReminder", required_only=True) <= set(body)
    assert body["intent"] == "create_reminder"
    assert body["triggerType"] in trigger_values()
    assert body["location"]["type"] in location_type_values()


def test_phone_type_knows_saved_place():
    assert "saved_place" in location_type_values()
