import pytest

from app import config

# Copied verbatim from mobile/src/data/mockReminders.ts so the contract is
# tested against what the phone really sends.
MOBILE_MOCK_1 = {
    "id": "mock-1",
    "title": "Buy milk",
    "description": "Pick up milk on the way home.",
    "createdAt": "2026-09-30T08:00:00.000Z",
    "deadline": "2026-09-30T18:00:00.000Z",
    "triggerType": "time",
    "completed": False,
}
MOBILE_MOCK_2 = {
    "id": "mock-2",
    "title": "Return library books",
    "createdAt": "2026-09-29T16:30:00.000Z",
    "deadline": "2026-10-02T17:00:00.000Z",
    "triggerType": "location",
    "location": {"type": "place", "name": "Public Library"},
    "completed": False,
}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_mobile_reminder_round_trips_with_client_id(client):
    r = client.post("/reminders", json=MOBILE_MOCK_1)
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "mock-1"  # the phone's id is kept, not replaced
    assert body["createdAt"] == "2026-09-30T08:00:00Z"
    assert body["deadline"] == "2026-09-30T18:00:00Z"
    assert body["triggerType"] == "time"
    assert body["completed"] is False
    # Absent optionals are omitted, not null, to match `description?: string`.
    assert "location" not in body and "lastNotifiedAt" not in body


def test_location_reminder_round_trips(client):
    body = client.post("/reminders", json=MOBILE_MOCK_2).json()
    assert body["location"] == {"type": "place", "name": "Public Library"}


def test_retrying_the_same_create_is_idempotent(client):
    first = client.post("/reminders", json=MOBILE_MOCK_1)
    again = client.post("/reminders", json=MOBILE_MOCK_1)  # lost response, phone retries
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    assert len(client.get("/reminders").json()) == 1


def test_same_id_different_reminder_is_409(client):
    client.post("/reminders", json=MOBILE_MOCK_1)
    other = {**MOBILE_MOCK_1, "title": "Something else"}
    assert client.post("/reminders", json=other).status_code == 409


def test_create_without_id_generates_one(client):
    r = client.post("/reminders", json={"title": "Call Mom", "triggerType": "time"})
    assert r.status_code == 201
    assert r.json()["id"] and r.json()["createdAt"]


def test_list_is_newest_first(client):
    client.post("/reminders", json=MOBILE_MOCK_1)
    client.post("/reminders", json=MOBILE_MOCK_2)
    ids = [x["id"] for x in client.get("/reminders").json()]
    assert ids == ["mock-1", "mock-2"]  # mock-1 was created later (09-30 vs 09-29)


def test_patch_complete_and_snooze_then_clear(client):
    client.post("/reminders", json=MOBILE_MOCK_1)
    r = client.patch(
        "/reminders/mock-1",
        json={"completed": True, "snoozedUntil": "2026-09-30T19:00:00.000Z"},
    )
    assert r.json()["completed"] is True
    assert r.json()["snoozedUntil"] == "2026-09-30T19:00:00Z"
    cleared = client.patch("/reminders/mock-1", json={"snoozedUntil": None}).json()
    assert "snoozedUntil" not in cleared
    assert cleared["completed"] is True  # untouched fields stay put


def test_patch_missing_is_404(client):
    assert client.patch("/reminders/nope", json={"completed": True}).status_code == 404


def test_delete(client):
    client.post("/reminders", json=MOBILE_MOCK_1)
    assert client.delete("/reminders/mock-1").status_code == 204
    assert client.get("/reminders").json() == []
    assert client.delete("/reminders/mock-1").status_code == 404


def test_location_trigger_requires_location(client):
    r = client.post("/reminders", json={"title": "x", "triggerType": "location"})
    assert r.status_code == 422


def test_deadline_without_timezone_is_rejected(client):
    r = client.post(
        "/reminders",
        json={"title": "x", "triggerType": "time", "deadline": "2026-10-02T17:00:00"},
    )
    assert r.status_code == 422


def test_saved_place_location_is_accepted(client):
    r = client.post(
        "/reminders",
        json={
            "title": "Take charger",
            "triggerType": "location",
            "location": {"type": "saved_place", "name": "home", "category": "anything goes"},
        },
    )
    assert r.status_code == 201


def test_session_parse_saves_into_a_session(client):
    r = client.post("/sessions/parse", json={"text": "remind me to call Mom in an hour"})
    assert r.status_code == 200
    body = r.json()
    assert body["sessionId"] and len(body["reminders"]) == 1
    saved = client.get("/reminders", params={"sessionId": body["sessionId"]}).json()
    assert [x["id"] for x in saved] == [body["reminders"][0]["id"]]
    assert saved[0]["sourceText"] == "remind me to call Mom in an hour"


def test_session_parse_keeps_a_given_session_id(client):
    r = client.post("/sessions/parse", json={"text": "buy eggs", "sessionId": "s1"}).json()
    assert r["sessionId"] == "s1"


def test_parse_is_flat_and_saves_nothing(client):
    r = client.post("/parse", json={"text": "remind me to call Mom in an hour"})
    assert r.status_code == 200
    body = r.json()
    assert body["intent"] == "create_reminder" and body["title"]
    assert "reminders" not in body and "id" not in body
    assert client.get("/reminders").json() == []  # nothing saved; the phone confirms first


def test_parse_with_nothing_to_remind_is_422(client, monkeypatch):
    monkeypatch.setattr("app.parser.parse", lambda *a, **k: [])
    assert client.post("/parse", json={"text": "nice weather"}).status_code == 422


def test_parse_returns_extra_commitments_in_additional(client, monkeypatch):
    from app.models import ReminderCreate

    two = [ReminderCreate(title="A", trigger_type="time"), ReminderCreate(title="B", trigger_type="time")]
    monkeypatch.setattr("app.parser.parse", lambda *a, **k: two)
    body = client.post("/parse", json={"text": "a and b"}).json()
    assert body["title"] == "A" and [x["title"] for x in body["additional"]] == ["B"]


def test_text_too_long_is_422(client):
    assert client.post("/parse", json={"text": "x" * 5001}).status_code == 422


def test_list_pagination(client):
    for i in range(5):
        client.post("/reminders", json={"id": f"r{i}", "title": "t", "triggerType": "time",
                                         "createdAt": f"2026-10-0{i + 1}T00:00:00Z"})
    page = client.get("/reminders", params={"limit": 2, "offset": 1}).json()
    assert [x["id"] for x in page] == ["r3", "r2"]
    assert client.get("/reminders", params={"limit": 0}).status_code == 422


def test_api_key_is_enforced_only_when_set(client, monkeypatch):
    assert client.get("/reminders").status_code == 200
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/reminders").status_code == 401
    assert client.get("/reminders", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/reminders", headers={"X-API-Key": "secret"}).status_code == 200
    assert client.get("/health").status_code == 200  # health stays open


@pytest.mark.parametrize("path", ["/parse", "/sessions/parse"])
def test_naive_now_is_422_not_500(client, path):
    r = client.post(path, json={"text": "x", "now": "2026-10-01T14:00:00"})
    assert r.status_code == 422


@pytest.mark.parametrize("path", ["/parse", "/sessions/parse"])
def test_overlong_timezone_is_422(client, path):
    assert client.post(path, json={"text": "x", "timezone": "a" * 65}).status_code == 422


# ---- code-review regressions ------------------------------------------------

def test_patch_cannot_store_an_unreadable_reminder(client):
    client.post("/reminders", json={"id": "a", "title": "t", "triggerType": "time"})
    client.post("/reminders", json=MOBILE_MOCK_2)
    # time -> location with no location
    assert client.patch("/reminders/a", json={"triggerType": "location"}).status_code == 422
    # removing the location from a location reminder
    assert client.patch("/reminders/mock-2", json={"location": None}).status_code == 422
    # blank title
    assert client.patch("/reminders/a", json={"title": ""}).status_code == 422
    # nothing was stored, so the list still works
    assert client.get("/reminders").status_code == 200
    assert len(client.get("/reminders").json()) == 2


def test_patch_that_keeps_it_valid_still_works(client):
    client.post("/reminders", json={"id": "a", "title": "t", "triggerType": "time"})
    r = client.patch("/reminders/a", json={
        "triggerType": "location", "location": {"type": "place", "name": "Target"}})
    assert r.status_code == 200 and r.json()["location"]["name"] == "Target"


def test_one_corrupt_row_does_not_take_down_the_list(client):
    from sqlmodel import Session

    from app.db import get_session
    from app.main import app
    from app.models import ReminderRow

    client.post("/reminders", json={"id": "good", "title": "ok", "triggerType": "time"})
    db = next(app.dependency_overrides[get_session]())
    db.add(ReminderRow(id="bad", title="x", trigger_type="location", location=None))
    db.commit()
    assert [r["id"] for r in client.get("/reminders").json()] == ["good"]


@pytest.mark.parametrize("field", ["createdAt", "snoozedUntil", "lastNotifiedAt"])
def test_naive_datetimes_on_create_are_422(client, field):
    body = {"title": "t", "triggerType": "time", field: "2026-10-01T10:00:00"}
    assert client.post("/reminders", json=body).status_code == 422


@pytest.mark.parametrize("field", ["deadline", "snoozedUntil", "lastNotifiedAt"])
def test_naive_datetimes_on_patch_are_422(client, field):
    client.post("/reminders", json={"id": "a", "title": "t", "triggerType": "time"})
    assert client.patch("/reminders/a", json={field: "2026-10-01T10:00:00"}).status_code == 422


@pytest.mark.parametrize("path", ["/parse", "/sessions/parse"])
def test_whitespace_only_text_is_422(client, path):
    assert client.post(path, json={"text": "   \n "}).status_code == 422


def test_non_ascii_api_key_header_is_401_not_500(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    r = client.get("/reminders", headers={"X-API-Key": "caf\u00e9".encode("latin-1")})
    assert r.status_code == 401


def test_default_database_path_is_absolute():
    from pathlib import Path

    assert Path(config.BACKEND_DIR).is_absolute()
    assert str(config.BACKEND_DIR) in f"sqlite:///{config.BACKEND_DIR / 'commitments.db'}"
