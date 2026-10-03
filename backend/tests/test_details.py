"""Finer-detail bugs found by targeted bug hunting, one test group each."""

import threading
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlmodel import Session, select

from app import parser, places, sessions
from app.db import init_db, make_engine
from app.models import EvalContext, Location, NearbyPlace, Reminder, SessionRow

NY = ZoneInfo("America/New_York")
IST = ZoneInfo("Asia/Kolkata")


# ---- 1. daylight saving: US clocks go back on Nov 1 2026, forward on Mar 8 2026 -----

def deadline(raw, tz=NY):
    return parser._coerce({"title": "t", "triggerType": "time", "deadline": raw}, tz, "s", "x").deadline


@pytest.mark.parametrize("raw, expect_utc", [
    ("2026-11-02T09:00:00-04:00", "2026-11-02T14:00"),  # copied summer offset past the change: means 9 AM EST
    ("2026-11-02T09:00:00-05:00", "2026-11-02T14:00"),  # already right: unchanged
    ("2026-10-05T09:00:00-04:00", "2026-10-05T13:00"),  # before the change: unchanged
    ("2026-03-10T09:00:00-05:00", "2026-03-10T13:00"),  # copied winter offset past spring-forward: 9 AM EDT
    ("2026-11-02T14:00:00Z", "2026-11-02T14:00"),       # an explicit UTC time is taken at face value
    ("2026-11-02T09:00:00", "2026-11-02T14:00"),        # no offset: read in the person's zone
])
def test_deadlines_across_a_clock_change_keep_the_wall_clock_time(raw, expect_utc):
    assert deadline(raw).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") == expect_utc


def test_a_zone_without_daylight_saving_is_left_alone():
    assert deadline("2026-11-02T09:00:00+05:30", IST).astimezone(timezone.utc).strftime("%H:%M") == "03:30"


def test_the_calendar_tells_the_model_each_days_offset():
    system = parser.build_messages("hi", datetime(2026, 10, 29, 14, 0, tzinfo=NY), NY)[0]["content"]
    assert "Sat 2026-10-31, offset -04:00" in system
    assert "Sun 2026-11-01, offset -05:00" in system
    assert "Thu 2026-10-29 (today), offset -04:00" in system


# ---- 2. two chunks start the same brand-new session at the same moment -------------

def test_concurrent_first_chunks_share_one_session_without_errors(tmp_path):
    eng = make_engine(f"sqlite:///{tmp_path}/race.db")
    init_db(eng)
    for attempt in range(5):
        sid, errors = f"race-{attempt}", []

        def go():
            try:
                with Session(eng) as s:
                    sessions.touch(s, sid)
            except Exception as e:  # noqa: BLE001
                errors.append(type(e).__name__)

        threads = [threading.Thread(target=go) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert errors == []
        with Session(eng) as s:
            assert len(s.exec(select(SessionRow).where(SessionRow.id == sid)).all()) == 1


# ---- 3. place names match on whole words ------------------------------------------

@pytest.mark.parametrize("wanted, actual, expected", [
    ("Target", "A", False), ("Target", "Tar", False), ("Home Depot", "Home", False),
    ("Target", "Target Hadley", True), ("CVS", "CVS Pharmacy", True),
    ("Trader Joe's", "Trader Joes", True), ("Stop & Shop", "Stop and Shop", True),
    ("the UPS Store", "UPS Store #1234", True), ("UPS", "USPS", False),
    ("", "Target", False), ("Target", None, False),
])
def test_names_match_on_whole_words(wanted, actual, expected):
    assert places.names_match(wanted, actual) is expected


# ---- 4. a category that arrives as `name`, and honest reasons -----------------------

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
SHOP = NearbyPlace(name="Stop & Shop", types=["supermarket"], distance_meters=40)


def evaluate(loc, nearby=(SHOP,)):
    r = Reminder(id="r", title="t", trigger_type="location", created_at=NOW, location=Location(**loc))
    return places.evaluate_location(r, EvalContext(nearby_places=list(nearby)), lambda n: None)


def test_a_category_sent_in_the_name_field_still_matches():
    out = evaluate({"type": "category", "name": "grocery_store"})
    assert out["matched"] is True and out["reason"] == "near Stop & Shop"


def test_reasons_never_say_none():
    assert evaluate({"type": "category", "category": "pharmacy"})["reason"] == "no nearby pharmacy within 150 m"
    assert evaluate({"type": "category", "category": "grocery_store"}, nearby=())["reason"] == "no nearby places provided"
    empty = evaluate({"type": "category"})
    assert empty["matched"] is False and "None" not in empty["reason"]


# ---- 5. the model's place labels are made consistent ------------------------------

def loc_of(model_location):
    item = {"title": "t", "triggerType": "location", "location": model_location}
    return parser._coerce(item, NY, "s", "x").location.model_dump(exclude_none=True)


@pytest.mark.parametrize("model_says, expected", [
    ({"type": "place", "name": "shopping mall"}, {"type": "category", "category": "shopping"}),   # seen live
    ({"type": "place", "name": "Pharmacy"}, {"type": "category", "category": "pharmacy"}),
    ({"type": "category", "category": "supermarket"}, {"type": "category", "category": "grocery_store"}),
    ({"type": "category", "name": "coffee shop"}, {"type": "category", "category": "coffee_shop"}),
    ({"type": "place", "name": "Target"}, {"type": "place", "name": "Target"}),                   # a real name stays
    ({"type": "category", "category": "bank"}, {"type": "category", "category": "bank"}),         # unknown kept as said
    ({"type": "saved_place", "name": "home"}, {"type": "saved_place", "name": "home"}),
])
def test_place_labels_are_made_consistent(model_says, expected):
    assert loc_of(model_says) == expected
