import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import get_session, init_db, make_engine
from app.main import app

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


@pytest.fixture()
def client():
    engine = make_engine("sqlite://")
    init_db(engine)

    def override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    # No `with`: skip the lifespan so the real on-disk database is never touched.
    yield TestClient(app)
    app.dependency_overrides.clear()


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


def test_duplicate_id_is_409(client):
    client.post("/reminders", json=MOBILE_MOCK_1)
    assert client.post("/reminders", json=MOBILE_MOCK_1).status_code == 409


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


def test_mock_parse_saves_into_a_session(client):
    r = client.post("/parse", json={"text": "remind me to call Mom in an hour"})
    assert r.status_code == 200
    body = r.json()
    assert body["sessionId"] and len(body["reminders"]) == 1
    saved = client.get("/reminders", params={"sessionId": body["sessionId"]}).json()
    assert [x["id"] for x in saved] == [body["reminders"][0]["id"]]
    assert saved[0]["sourceText"] == "remind me to call Mom in an hour"


def test_parse_keeps_a_given_session_id(client):
    r = client.post("/parse", json={"text": "buy eggs", "sessionId": "s1"}).json()
    assert r["sessionId"] == "s1"
