"""Round of fixes from the 2026-10-12 review: place labels, saved places, bad
numbers, session ids and createdAt from the phone."""

from datetime import datetime, timedelta, timezone

import pytest
from zoneinfo import ZoneInfo

from app import config, llm, parser, places
from app.models import EvalContext, Location, NearbyPlace, Reminder

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
UTC = ZoneInfo("UTC")


def reminder(**loc):
    return Reminder(id="r", title="t", trigger_type="location", created_at=NOW, location=Location(**loc))


def near(*types, name="Somewhere"):
    return EvalContext(nearby_places=[NearbyPlace(name=name, types=list(types), distance_meters=20)])


# ---- generic provider labels don't make a category match ---------------------

@pytest.mark.parametrize("wanted, raw", [
    ("shopping", ["store"]),               # on supermarkets and pharmacies too
    ("restaurant", ["food"]),              # on grocers too
    ("shopping", ["pharmacy", "store"]),   # "at the mall" must not fire at CVS
])
def test_a_generic_label_alone_does_not_match_a_category(wanted, raw):
    r = places.evaluate_location(reminder(type="category", category=wanted), near(*raw), lambda n: None)
    assert r["matched"] is False


def test_the_specific_label_still_matches():
    r = places.evaluate_location(reminder(type="category", category="shopping"), near("shopping_mall", "store"),
                                 lambda n: None)
    assert r["matched"] is True


# ---- the person's own places never become a category -------------------------

def model_says(monkeypatch, location):
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: {"reminders": [
        {"title": "Return the book", "triggerType": "location", "location": location}]})


@pytest.mark.parametrize("location", [
    {"type": "place", "name": "school"},
    {"type": "category", "category": "school"},
    {"type": "place", "name": "campus"},
    {"type": "category", "name": "School"},
])
def test_school_said_any_way_is_the_saved_school(monkeypatch, location):
    model_says(monkeypatch, location)
    (r,) = parser.parse_llm("return the book when I get to school", NOW, UTC, "s")
    assert r.location.model_dump(exclude_none=True) == {"type": "saved_place", "name": "school"}


@pytest.mark.parametrize("word", ["home", "work", "office", "my house"])
def test_home_and_work_labelled_as_a_place_are_saved_places(monkeypatch, word):
    model_says(monkeypatch, {"type": "place", "name": word})
    (r,) = parser.parse_llm("x", NOW, UTC, "s")
    assert r.location.type == "saved_place"


def test_a_real_university_category_is_untouched(monkeypatch):
    model_says(monkeypatch, {"type": "category", "category": "college"})
    (r,) = parser.parse_llm("x", NOW, UTC, "s")
    assert r.location.model_dump(exclude_none=True) == {"type": "category", "category": "university"}


# ---- numbers a reminder could never trigger with are refused -----------------

BASE = {"id": "geo", "title": "Water plants", "createdAt": "2026-10-02T12:00:00Z", "triggerType": "location"}


@pytest.mark.parametrize("loc", [
    {"type": "coordinate", "latitude": "NaN", "longitude": 1},
    {"type": "coordinate", "latitude": 1, "longitude": "Infinity"},
    {"type": "coordinate", "latitude": 91, "longitude": 0},
    {"type": "coordinate", "latitude": 0, "longitude": -181},
    {"type": "coordinate", "latitude": 0, "longitude": 0, "radiusMeters": -5},
    {"type": "coordinate", "latitude": 0, "longitude": 0, "radiusMeters": 0},
    {"type": "coordinate", "latitude": 0, "longitude": 0, "radiusMeters": 1e9},
])
def test_unusable_coordinates_are_rejected(client, loc):
    assert client.post("/reminders", json={**BASE, "location": loc}).status_code == 422


def test_a_good_coordinate_is_accepted(client):
    loc = {"type": "coordinate", "latitude": 42.39, "longitude": -72.53, "radiusMeters": 200}
    assert client.post("/reminders", json={**BASE, "location": loc}).status_code in (200, 201)


def test_a_bad_coordinate_in_an_update_is_rejected_too(client):
    client.post("/reminders", json={**BASE, "location": {"type": "category", "category": "gym"}})
    bad = {"location": {"type": "coordinate", "latitude": 0, "longitude": 0, "radiusMeters": -1}}
    assert client.patch("/reminders/geo", json=bad).status_code == 422


# ---- session ids and createdAt from the phone ---------------------------------

def test_a_huge_session_id_is_refused(client):
    assert client.post("/sessions/parse", json={"text": "buy milk", "sessionId": "x" * 5000}).status_code == 422
    assert client.post("/reminders", json={**BASE, "triggerType": "time", "sessionId": "x" * 5000}).status_code == 422


def test_a_normal_session_id_works(client):
    sid = "6f1c2b9e-1d3a-4f6b-9a1e-2c3d4e5f6a7b"
    assert client.post("/sessions/parse", json={"text": "buy milk", "sessionId": sid}).status_code == 200


def test_a_created_at_in_the_far_future_is_brought_back_to_now(client):
    body = {**BASE, "id": "future", "triggerType": "time", "createdAt": "2099-01-01T00:00:00Z"}
    saved = client.post("/reminders", json=body).json()
    created = datetime.fromisoformat(saved["createdAt"].replace("Z", "+00:00"))
    assert created < datetime.now(timezone.utc) + timedelta(minutes=6)


def test_a_phone_clock_a_little_ahead_is_kept(client):
    ahead = (datetime.now(timezone.utc) + timedelta(minutes=2)).replace(microsecond=0)
    body = {**BASE, "id": "skew", "triggerType": "time", "createdAt": ahead.isoformat()}
    saved = client.post("/reminders", json=body).json()
    assert datetime.fromisoformat(saved["createdAt"].replace("Z", "+00:00")) == ahead


def test_a_past_created_at_is_kept_as_sent(client):
    saved = client.post("/reminders", json={**BASE, "id": "past", "triggerType": "time"}).json()
    assert saved["createdAt"].startswith("2026-10-02T12:00:00")
