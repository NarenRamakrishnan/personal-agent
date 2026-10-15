"""Per-device tokens: each phone's data is its own, and one phone can't use up the day."""

import json
import types
from datetime import timedelta

import pytest
from sqlmodel import select

from app import config, llm, retention
from app.models import DeviceRow, ReminderRow, utcnow
from app.security import hash_token
from tests.test_privacy import db_of


def device(client):
    r = client.post("/devices")
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def two(client, monkeypatch):
    # Behave like a real deploy: nothing is open without credentials.
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@h:5432/d")
    return device(client), device(client)


def remind(client, h, id, title="Buy milk", **extra):
    body = {"id": id, "title": title, "triggerType": "time", "createdAt": "2026-10-10T12:00:00Z", **extra}
    return client.post("/reminders", json=body, headers=h)


# ---- getting in ----------------------------------------------------------------

def test_a_token_is_shown_once_and_only_its_hash_is_kept(client):
    r = client.post("/devices").json()
    with db_of(client) as db:
        row = db.get(DeviceRow, r["deviceId"])
    assert row.token_hash == hash_token(r["token"]) and r["token"] not in row.token_hash


def test_no_credentials_bad_token_or_revoked_token_is_refused(client, two):
    a, _ = two
    assert client.get("/reminders").status_code == 401
    assert client.get("/reminders", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/reminders", headers=a).status_code == 200
    with db_of(client) as db:
        for row in db.exec(select(DeviceRow)):
            row.revoked = True
            db.add(row)
        db.commit()
    assert client.get("/reminders", headers=a).status_code == 401


def test_the_shared_api_key_still_works_and_a_wrong_one_does_not(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "k")
    assert client.get("/reminders", headers={"X-API-Key": "k"}).status_code == 200
    assert client.get("/reminders", headers={"X-API-Key": "x"}).status_code == 401
    assert client.get("/reminders").status_code == 401


def test_new_devices_are_capped_per_hour(client, monkeypatch):
    monkeypatch.setattr(config, "DEVICE_SIGNUPS_PER_HOUR", 2)
    assert [client.post("/devices").status_code for _ in range(3)] == [201, 201, 429]


# ---- each device only sees its own --------------------------------------------

def test_reminders_are_private_to_their_device(client, two):
    a, b = two
    assert remind(client, a, "r1").status_code == 201
    assert client.get("/reminders", headers=b).json() == []
    for method, path, body in [("patch", "/reminders/r1", {"title": "x"}), ("delete", "/reminders/r1", None)]:
        assert client.request(method.upper(), path, json=body, headers=b).status_code == 404
    assert remind(client, b, "r1").status_code == 409  # same id, no peek at what's there
    assert client.post("/evaluate-reminder", json={"reminderId": "r1", "context": {}}, headers=b).status_code == 404
    assert [r["id"] for r in client.get("/reminders", headers=a).json()] == ["r1"]


def test_sessions_are_private_to_their_device(client, two):
    a, b = two
    sid = client.post("/sessions/parse", json={"text": "buy milk", "sessionId": "s-a"}, headers=a).json()["sessionId"]
    assert client.post("/sessions/parse", json={"text": "buy eggs", "sessionId": sid}, headers=b).status_code == 404
    for method, path in [("GET", f"/sessions/{sid}"), ("POST", f"/sessions/{sid}/end"), ("POST", f"/sessions/{sid}/retry"),
                         ("DELETE", f"/sessions/{sid}"), ("DELETE", f"/sessions/{sid}/transcript")]:
        assert client.request(method, path, headers=b).status_code == 404, path
    assert len(client.get(f"/sessions/{sid}", headers=a).json()["reminders"]) == 1


def test_a_typed_reminder_naming_anothers_session_stays_out_of_its_review(client, two):
    a, b = two
    client.post("/sessions/parse", json={"text": "buy milk", "sessionId": "s-a"}, headers=a)
    remind(client, b, "sneak", sessionId="s-a")
    assert [r["title"] for r in client.get("/sessions/s-a", headers=a).json()["reminders"]] != ["sneak"]
    assert all(r["id"] != "sneak" for r in client.get("/sessions/s-a", headers=a).json()["reminders"])


def test_each_device_has_its_own_home(client, two):
    a, b = two
    client.put("/saved-places/home", json={"name": "home", "latitude": 10, "longitude": 10}, headers=a)
    client.put("/saved-places/home", json={"name": "home", "latitude": 50, "longitude": 50}, headers=b)
    assert client.get("/saved-places", headers=a).json()[0]["latitude"] == 10
    assert client.get("/saved-places", headers=b).json()[0]["latitude"] == 50
    reminder = {"id": "e", "title": "Charger", "triggerType": "location", "createdAt": "2026-10-10T12:00:00Z",
                "location": {"type": "saved_place", "name": "home"}}
    at_a_home = {"latitude": 10, "longitude": 10, "nearbyPlaces": []}
    assert client.post("/evaluate-reminder", json={"reminder": reminder, "context": at_a_home}, headers=a).json()["location"]["matched"]
    assert not client.post("/evaluate-reminder", json={"reminder": reminder, "context": at_a_home}, headers=b).json()["location"]["matched"]
    assert client.delete("/saved-places/home", headers=a).status_code == 204
    assert client.get("/saved-places", headers=b).json()[0]["latitude"] == 50


def test_email_drafts_are_private_to_their_device(client, two):
    a, b = two
    d = client.post("/actions/email", json={"text": "email Alex that I'm late"}, headers=a).json()
    assert client.get("/actions", headers=b).json() == []
    for method, path in [("GET", f"/actions/{d['id']}"), ("POST", f"/actions/{d['id']}/approve"), ("POST", f"/actions/{d['id']}/cancel")]:
        assert client.request(method, path, headers=b).status_code == 404, path
    assert client.patch(f"/actions/{d['id']}", json={"subject": "x"}, headers=b).status_code == 404


def test_settings_and_privacy_counts_are_per_device(client, two):
    a, b = two
    client.patch("/settings", json={"timezoneMode": "manual", "timezone": "Asia/Kolkata"}, headers=a)
    assert client.get("/settings", headers=b).json()["timezoneMode"] == "auto"
    remind(client, a, "r1")
    assert client.get("/privacy", headers=a).json()["counts"]["reminders"] == 1
    assert client.get("/privacy", headers=b).json()["counts"]["reminders"] == 0


def test_delete_history_and_the_transcript_switch_only_touch_that_device(client, two):
    a, b = two
    remind(client, a, "ra", sourceText="words a")
    remind(client, b, "rb", sourceText="words b")
    client.patch("/settings", json={"keepTranscripts": False}, headers=a)
    with db_of(client) as db:
        assert db.get(ReminderRow, "ra").source_text is None
        assert db.get(ReminderRow, "rb").source_text == "words b"
    assert client.delete("/history?confirm=delete-everything", headers=a).json()["deleted"]["reminders"] == 1
    assert [r["id"] for r in client.get("/reminders", headers=b).json()] == ["rb"]


def test_a_shorter_retention_setting_only_applies_to_that_device(client, two):
    a, b = two
    remind(client, a, "ra", sourceText="old a")
    remind(client, b, "rb", sourceText="old b")
    with db_of(client) as db:
        for rid in ("ra", "rb"):
            row = db.get(ReminderRow, rid)
            row.created_at = utcnow() - timedelta(days=3)
            db.add(row)
        db.commit()
    client.patch("/settings", json={"deleteTranscriptsAfterDays": 1}, headers=a)
    with db_of(client) as db:
        retention.purge_expired(db)
        assert db.get(ReminderRow, "ra").source_text is None
        assert db.get(ReminderRow, "rb").source_text == "old b"


def test_the_model_is_only_shown_that_devices_open_reminders(client, two, monkeypatch):
    a, b = two
    remind(client, a, "ra", title="Return library book")
    prompts = []

    def chat(messages, model=None):
        prompts.append("\n".join(m["content"] for m in messages))
        return {"reminders": []}

    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", chat)
    client.post("/sessions/parse", json={"text": "I returned it", "sessionId": "s-b"}, headers=b)
    assert prompts and "library book" not in prompts[-1].lower()


# ---- one device can't use up the day ----------------------------------------------

class _Client:
    """Stands in for the Nebius client so the real spend guard runs."""

    def __init__(self):
        reply = types.SimpleNamespace(content=json.dumps({"reminders": []}))
        resp = types.SimpleNamespace(choices=[types.SimpleNamespace(message=reply)],
                                     usage=types.SimpleNamespace(total_tokens=10))
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=lambda **kw: resp))

    def with_options(self, **kw):
        return self


def test_a_device_has_its_own_daily_model_call_limit(client, two, monkeypatch):
    a, b = two
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(config, "DEVICE_DAILY_CALL_LIMIT", 2)
    monkeypatch.setattr(llm, "get_client", lambda: _Client())
    say = lambda h, sid: client.post("/sessions/parse", json={"text": "call mom tomorrow", "sessionId": sid}, headers=h)
    assert [say(a, "sa").status_code for _ in range(3)] == [200, 200, 202]  # third is queued, not lost
    assert say(b, "sb").status_code == 200  # the other device still has its own room
    usage = client.get("/usage", headers=b).json()
    assert usage["calls"] == 3  # the refused call never reached Nebius or the daily count


# ---- keep-alive ----------------------------------------------------------------------

def test_keep_alive_needs_the_cron_secret(client, monkeypatch):
    assert client.get("/cron/keep-alive").status_code == 401  # no secret configured
    monkeypatch.setattr(config, "CRON_SECRET", "s3cret")
    assert client.get("/cron/keep-alive", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/cron/keep-alive", headers={"Authorization": "Bearer s3cret"}).json() == {"status": "ok"}
