from datetime import datetime, timedelta, timezone

import pytest

from app import places
from app.models import EvalContext, Location, NearbyPlace, Reminder

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
HOME = (42.3868, -72.5301)  # a point to measure from
LAT_100M = 100 / 111_195.0  # degrees of latitude per 100 m


def at(dlat_m=0.0):
    return HOME[0] + dlat_m / 111_195.0, HOME[1]


def rem(trigger="location", **loc):
    return Reminder(id="r", title="t", trigger_type=trigger, created_at=NOW,
                    location=Location(**loc) if loc else None)


def ctx(**kw):
    return EvalContext(**kw)


def lookup_with(**saved):
    return lambda name: saved.get(name)


NONE = lookup_with()


# ---- distance ------------------------------------------------------------

def test_haversine_against_known_geometry():
    assert places.distance_m(0, 0, 1, 0) == pytest.approx(111_195, rel=0.001)   # 1 degree of latitude
    assert places.distance_m(*HOME, *HOME) == 0
    assert places.distance_m(*HOME, *at(100)) == pytest.approx(100, rel=0.01)
    assert places.distance_m(0, 0, 0, 90) == pytest.approx(10_007_543, rel=0.001)  # quarter of the equator


# ---- taxonomy ------------------------------------------------------------

@pytest.mark.parametrize("term, expected", [
    ("grocery_store", "grocery_store"), ("Grocery Store", "grocery_store"), ("supermarket", "grocery_store"),
    ("drugstore", "pharmacy"), ("pharmacy", "pharmacy"), ("cafe", "coffee_shop"), ("Coffee-Shop", "coffee_shop"),
    ("fitness center", "gym"), ("shopping_mall", "shopping"), ("college", "university"),
    ("bank", None), ("", None), (None, None),
])
def test_canonical_category(term, expected):
    assert places.canonical_category(term) == expected


@pytest.mark.parametrize("term, expected", [("Home", "home"), ("my house", "home"), ("Office", "work"),
                                            ("dorm", "home"), ("gym buddy", "gym_buddy")])
def test_saved_place_aliases(term, expected):
    assert places.saved_place_name(term) == expected


# ---- reminders without a location ---------------------------------------

def test_time_reminder_has_no_location_signal():
    r = places.evaluate_location(rem("time"), ctx(), NONE)
    assert r["applicable"] is False and r["matched"] is False


# ---- saved places --------------------------------------------------------

def test_saved_place_inside_and_outside_the_radius():
    r = rem(type="saved_place", name="home")
    look = lookup_with(home=(*HOME, 150.0))
    inside = places.evaluate_location(r, ctx(latitude=at(100)[0], longitude=HOME[1]), look)
    outside = places.evaluate_location(r, ctx(latitude=at(200)[0], longitude=HOME[1]), look)
    assert inside["matched"] is True and inside["distance_meters"] == pytest.approx(100, rel=0.02)
    assert outside["matched"] is False and "200" in outside["reason"]


def test_saved_place_not_set_says_so():
    r = places.evaluate_location(rem(type="saved_place", name="home"), ctx(latitude=1, longitude=1), NONE)
    assert r["matched"] is False and "not been set" in r["reason"]


def test_saved_place_alias_resolves():
    r = rem(type="saved_place", name="my house")
    out = places.evaluate_location(r, ctx(latitude=HOME[0], longitude=HOME[1]), lookup_with(home=(*HOME, 150.0)))
    assert out["matched"] is True


def test_saved_place_without_a_position_fix():
    r = places.evaluate_location(rem(type="saved_place", name="home"), ctx(), lookup_with(home=(*HOME, 150.0)))
    assert r["matched"] is False and "unknown" in r["reason"]


def test_named_place_that_is_a_saved_place_uses_the_saved_location():
    r = rem(type="place", name="home")
    out = places.evaluate_location(r, ctx(latitude=HOME[0], longitude=HOME[1]), lookup_with(home=(*HOME, 150.0)))
    assert out["matched"] is True


# ---- coordinates ---------------------------------------------------------

def test_coordinate_uses_its_own_radius():
    r = rem(type="coordinate", latitude=HOME[0], longitude=HOME[1], radius_meters=50)
    near = places.evaluate_location(r, ctx(latitude=at(40)[0], longitude=HOME[1]), NONE)
    far = places.evaluate_location(r, ctx(latitude=at(80)[0], longitude=HOME[1]), NONE)
    assert near["matched"] is True and far["matched"] is False


def test_incomplete_coordinate_is_not_a_crash():
    r = places.evaluate_location(rem(type="coordinate", latitude=1.0), ctx(latitude=1, longitude=1), NONE)
    assert r["matched"] is False


# ---- category and named places ------------------------------------------

def grocery(**kw):
    return NearbyPlace(name="Stop & Shop", types=["supermarket", "food"], **kw)


def test_category_matches_through_raw_type_labels():
    r = rem(type="category", category="grocery_store")
    assert places.evaluate_location(r, ctx(nearby_places=[grocery(distance_meters=60)]), NONE)["matched"] is True


def test_category_respects_the_distance_limit():
    r = rem(type="category", category="grocery_store")
    assert places.evaluate_location(r, ctx(nearby_places=[grocery(distance_meters=400)]), NONE)["matched"] is False


def test_distance_computed_from_coordinates_when_not_given():
    r = rem(type="category", category="grocery_store")
    p = grocery(latitude=at(90)[0], longitude=HOME[1])
    out = places.evaluate_location(r, ctx(latitude=HOME[0], longitude=HOME[1], nearby_places=[p]), NONE)
    assert out["matched"] is True and out["distance_meters"] == pytest.approx(90, rel=0.02)


def test_place_with_no_distance_info_is_assumed_nearby():
    r = rem(type="category", category="pharmacy")
    p = NearbyPlace(name="CVS", types=["drugstore"])
    assert places.evaluate_location(r, ctx(nearby_places=[p]), NONE)["matched"] is True


def test_wrong_category_does_not_match():
    r = rem(type="category", category="pharmacy")
    assert places.evaluate_location(r, ctx(nearby_places=[grocery(distance_meters=10)]), NONE)["matched"] is False


def test_unknown_category_matches_only_the_exact_label():
    r = rem(type="category", category="bank")
    assert places.evaluate_location(r, ctx(nearby_places=[NearbyPlace(types=["bank"], distance_meters=5)]), NONE)["matched"] is True
    assert places.evaluate_location(r, ctx(nearby_places=[NearbyPlace(types=["atm"], distance_meters=5)]), NONE)["matched"] is False


def test_named_place_matches_loosely_on_the_name():
    r = rem(type="place", name="Target")
    p = NearbyPlace(name="Target Hadley", types=["department_store"], distance_meters=80)
    other = NearbyPlace(name="Trader Joe's", types=["supermarket"], distance_meters=20)
    assert places.evaluate_location(r, ctx(nearby_places=[other, p]), NONE)["matched"] is True
    assert places.evaluate_location(r, ctx(nearby_places=[other]), NONE)["matched"] is False


def test_nothing_nearby_reports_why():
    out = places.evaluate_location(rem(type="category", category="gym"), ctx(), NONE)
    assert out["matched"] is False and "no nearby places" in out["reason"]


def test_closest_matching_place_wins():
    r = rem(type="category", category="grocery_store")
    far, close = grocery(distance_meters=140), NearbyPlace(name="Close Mart", types=["supermarket"], distance_meters=30)
    out = places.evaluate_location(r, ctx(nearby_places=[far, close]), NONE)
    assert out["distance_meters"] == 30


# ---- the endpoint --------------------------------------------------------

def test_saved_places_crud_and_alias(client):
    body = {"name": "home", "latitude": HOME[0], "longitude": HOME[1], "radiusMeters": 120}
    assert client.put("/saved-places/Home", json=body).json()["radiusMeters"] == 120
    assert [p["name"] for p in client.get("/saved-places").json()] == ["home"]
    assert client.put("/saved-places/my house", json={**body, "radiusMeters": 200}).json()["radiusMeters"] == 200
    assert len(client.get("/saved-places").json()) == 1  # alias updated the same place
    assert client.delete("/saved-places/home").status_code == 204
    assert client.delete("/saved-places/home").status_code == 404


def test_saved_place_validation(client):
    bad = {"name": "home", "latitude": 95, "longitude": 0}
    assert client.put("/saved-places/home", json=bad).status_code == 422
    assert client.put("/saved-places/home", json={"name": "h", "latitude": 0, "longitude": 0, "radiusMeters": 99999}).status_code == 422


def test_evaluate_combines_time_and_location(client):
    client.put("/saved-places/home", json={"name": "home", "latitude": HOME[0], "longitude": HOME[1]})
    client.post("/reminders", json={
        "id": "feed", "title": "Feed the cat", "triggerType": "time_and_location",
        "deadline": (NOW - timedelta(minutes=5)).isoformat(),
        "location": {"type": "saved_place", "name": "home"}})
    body = client.post("/evaluate-reminder", json={
        "reminderId": "feed",
        "context": {"now": NOW.isoformat(), "latitude": HOME[0], "longitude": HOME[1]}}).json()
    assert body["timeStatus"] == "due" and body["shouldTimeNotify"] is True
    assert body["location"]["matched"] is True and body["reminderId"] == "feed"


def test_evaluate_accepts_an_unsynced_inline_reminder(client):
    body = client.post("/evaluate-reminder", json={
        "reminder": {"id": "local-1", "title": "x", "triggerType": "location", "createdAt": NOW.isoformat(),
                     "completed": False, "location": {"type": "category", "category": "pharmacy"}},
        "context": {"now": NOW.isoformat(),
                    "nearbyPlaces": [{"name": "CVS", "types": ["drugstore"], "distanceMeters": 40}]}}).json()
    assert body["location"]["matched"] is True and body["timeStatus"] == "none"


def test_evaluate_needs_exactly_one_of_id_or_reminder(client):
    assert client.post("/evaluate-reminder", json={"context": {}}).status_code == 422
    assert client.post("/evaluate-reminder", json={"reminderId": "x", "reminder": {
        "id": "y", "title": "t", "triggerType": "time", "createdAt": NOW.isoformat(), "completed": False}}).status_code == 422


def test_evaluate_unknown_reminder_404_and_bad_input_422(client):
    assert client.post("/evaluate-reminder", json={"reminderId": "nope"}).status_code == 404
    client.post("/reminders", json={"id": "a", "title": "t", "triggerType": "time"})
    for ctx_bad in ({"latitude": 200, "longitude": 0}, {"now": "2026-10-02T12:00:00"}):
        assert client.post("/evaluate-reminder", json={"reminderId": "a", "context": ctx_bad}).status_code == 422


def test_evaluate_requires_the_api_key_when_set(client, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/saved-places").status_code == 401
    assert client.post("/evaluate-reminder", json={"reminderId": "a"}).status_code == 401
