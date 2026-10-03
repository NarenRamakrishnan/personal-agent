from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlmodel import Session, select

from app import config, llm, parser, settings
from app.db import get_session
from app.main import app
from app.models import ReminderRow, utcnow

NY, IST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Kolkata")


def db_of(client):
    return Session(next(app.dependency_overrides[get_session]()).get_bind())


def patch(client, **body):
    return client.patch("/settings", json=body)


def details(r):
    d = r.json()["detail"]
    return d if isinstance(d, str) else " | ".join(e["msg"] for e in d)


# ---- reading and changing settings -----------------------------------------------

def test_defaults_before_anything_is_changed(client):
    s = client.get("/settings").json()
    assert s == {
        "timezoneMode": "auto",
        "timesOfDay": {"morning": "09:00", "afternoon": "15:00", "evening": "18:00", "tonight": "20:00"},
        "notifyLevel": "normal", "nearRadiusMeters": 150.0, "keepTranscripts": True,
        "serverKeepsTranscripts": True, "serverRetentionDays": config.TRANSCRIPT_RETENTION_DAYS,
    }


def test_a_change_persists_and_leaves_everything_else_alone(client):
    patch(client, notifyLevel="fewer")
    patch(client, nearRadiusMeters=300)
    s = client.get("/settings").json()
    assert s["notifyLevel"] == "fewer" and s["nearRadiusMeters"] == 300 and s["timezoneMode"] == "auto"


@pytest.mark.parametrize("given, hint", [("EST", "America/New_York"), ("ist", "Asia/Kolkata"), ("PST", "America/Los_Angeles"),
                                         ("Mars/Base", "America/New_York or Asia/Kolkata"), ("EST5EDT", "Use a name like")])
def test_a_bad_timezone_explains_how_to_fix_it(client, given, hint):
    r = patch(client, timezone=given)
    assert r.status_code == 422 and hint in details(r)


def test_manual_mode_needs_a_timezone(client):
    r = patch(client, timezoneMode="manual")
    assert r.status_code == 422 and "Choose a timezone" in details(r)
    assert patch(client, timezoneMode="manual", timezone="Asia/Kolkata").status_code == 200
    assert patch(client, timezone=None).status_code == 422  # can't clear it while still manual


@pytest.mark.parametrize("body", [{"timezon": "Asia/Kolkata"}, {"timesOfDay": {"nite": "22:00"}}])
def test_a_misspelt_setting_is_an_error_not_silently_ignored(client, body):
    assert client.patch("/settings", json=body).status_code == 422


@pytest.mark.parametrize("body", [
    {"quietHours": {"start": "25:00", "end": "07:00"}}, {"quietHours": {"start": "23:00", "end": "23:00"}},
    {"quietHours": {"start": "11pm", "end": "7am"}}, {"timesOfDay": {"tonight": "8:00"}},
    {"nearRadiusMeters": 10}, {"nearRadiusMeters": 5000}, {"notifyLevel": "loud"},
    {"deleteTranscriptsAfterDays": 0}, {"deleteTranscriptsAfterDays": 400},
])
def test_out_of_range_values_are_rejected(client, body):
    assert client.patch("/settings", json=body).status_code == 422


def test_quiet_hours_can_be_set_and_turned_off(client):
    assert patch(client, quietHours={"start": "23:00", "end": "07:00"}).json()["quietHours"] == {"start": "23:00", "end": "07:00"}
    assert "quietHours" not in patch(client, quietHours=None).json()


def test_settings_need_the_api_key_when_set(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/settings").status_code == 401 and patch(client, notifyLevel="more").status_code == 401


# ---- timezone: which one wins ----------------------------------------------------

def prefs(**kw):
    return settings.Prefs(**kw)


@pytest.mark.parametrize("p, phone, expected", [
    (prefs(), "Asia/Kolkata", "Asia/Kolkata"),                                              # auto: the phone
    (prefs(), None, config.DEFAULT_TIMEZONE),                                              # auto, nothing known
    (prefs(timezone="Asia/Kolkata"), None, "Asia/Kolkata"),                                # auto: last chosen zone
    (prefs(timezone_mode="manual", timezone="Asia/Kolkata"), "America/New_York", "Asia/Kolkata"),  # manual wins
    (prefs(), "Not/AZone", config.DEFAULT_TIMEZONE),                                       # junk from the phone
])
def test_which_timezone_is_used(p, phone, expected):
    assert settings.timezone_for(p, phone) == expected


def test_manual_timezone_reaches_the_parser(client, monkeypatch):
    seen = []
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(parser, "parse", lambda text, now, sid, tz_name=None, **k: seen.append(tz_name) or [])
    patch(client, timezoneMode="manual", timezone="Asia/Kolkata")
    client.post("/parse", json={"text": "x", "timezone": "America/New_York"})
    client.post("/sessions/parse", json={"text": "x", "sessionId": "s", "timezone": "America/New_York"})
    assert seen == ["Asia/Kolkata", "Asia/Kolkata"]


# ---- times of day ----------------------------------------------------------------

def test_your_times_of_day_reach_the_model(client, monkeypatch):
    prompts = []
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: prompts.append(m[0]["content"]) or {"reminders": []})
    patch(client, timesOfDay={"tonight": "22:30"})
    client.post("/sessions/parse", json={"text": "call mom tonight", "sessionId": "s"})
    assert "use 22:30" in prompts[0] and "tonight or night 22:30" in prompts[0]
    assert "morning 09:00" in prompts[0]  # untouched ones keep their defaults


# ---- quiet hours -----------------------------------------------------------------

Q = prefs(quiet=(settings._hhmm("23:00"), settings._hhmm("07:00")))


@pytest.mark.parametrize("local, until", [
    ("2026-10-03T23:30", "2026-10-04T07:00"), ("2026-10-04T06:59", "2026-10-04T07:00"),
    ("2026-10-03T23:00", "2026-10-04T07:00"), ("2026-10-04T07:00", None), ("2026-10-03T22:59", None),
])
def test_quiet_hours_across_midnight(local, until):
    got = settings.quiet_until(Q, datetime.fromisoformat(local).replace(tzinfo=NY), NY)
    assert (got.strftime("%Y-%m-%dT%H:%M") if got else None) == until


def test_daytime_quiet_hours_and_the_night_the_clocks_change():
    lunch = prefs(quiet=(settings._hhmm("13:00"), settings._hhmm("14:00")))
    assert settings.quiet_until(lunch, datetime(2026, 10, 3, 13, 30, tzinfo=NY), NY).hour == 14
    assert settings.quiet_until(lunch, datetime(2026, 10, 3, 14, 0, tzinfo=NY), NY) is None
    # Nov 1 2026: clocks go back at 2 AM. Quiet hours still end at 07:00 on the wall (EST).
    end = settings.quiet_until(Q, datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc), NY)  # 1:30 AM EDT
    assert end.astimezone(timezone.utc) == datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def evaluate_due(client, local_now):
    deadline = (local_now - timedelta(minutes=5)).isoformat()
    client.post("/reminders", json={"id": "r", "title": "Take meds", "triggerType": "time", "deadline": deadline})
    return client.post("/evaluate-reminder", json={"reminderId": "r", "context": {"now": local_now.isoformat(), "timezone": "America/New_York"}}).json()


def test_a_due_reminder_is_held_until_quiet_hours_end(client):
    patch(client, quietHours={"start": "23:00", "end": "07:00"})
    body = evaluate_due(client, datetime(2026, 10, 3, 2, 0, tzinfo=NY))
    assert body["notify"] is False
    assert datetime.fromisoformat(body["quietUntil"].replace("Z", "+00:00")).astimezone(NY).strftime("%H:%M") == "07:00"
    assert {"label": "quiet hours until 07:00", "points": 0} in body["reasons"]


def test_outside_quiet_hours_nothing_is_held(client):
    patch(client, quietHours={"start": "23:00", "end": "07:00"})
    body = evaluate_due(client, datetime(2026, 10, 3, 9, 0, tzinfo=NY))
    assert body["notify"] is True and "quietUntil" not in body


# ---- notification level ----------------------------------------------------------

def rem(**kw):
    from app.models import Location, Reminder
    base = dict(id="r", title="t", trigger_type="location", created_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
                location=Location(type="category", category="pharmacy"))
    return Reminder(**{**base, **kw})


NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


def level(name):
    t, c = settings.notify_levels()[name]
    return prefs(threshold=t, cooldown_min=c)


def test_fewer_needs_place_and_timing_together():
    from app import scoring
    assert scoring.decide(rem(), NOW, True, NY, level("fewer"))["notify"] is False                          # place alone
    assert scoring.decide(rem(deadline=NOW + timedelta(hours=1)), NOW, True, NY, level("fewer"))["notify"] is True


def test_more_repeats_sooner():
    from app import scoring
    r = rem(deadline=NOW + timedelta(hours=1), last_notified_at=NOW - timedelta(minutes=15))
    assert scoring.decide(r, NOW, True, NY, level("normal"))["notify"] is False   # inside the 30 min cooldown
    assert scoring.decide(r, NOW, True, NY, level("more"))["notify"] is True      # 10 min cooldown has passed


@pytest.mark.parametrize("name", ["fewer", "normal", "more"])
def test_no_level_ever_repeats_inside_its_own_cooldown(name):
    from app import scoring
    p = level(name)
    best_inside = rem(deadline=NOW + timedelta(minutes=30), last_notified_at=NOW - timedelta(minutes=1))
    assert scoring.decide(best_inside, NOW, True, NY, p)["notify"] is False


# ---- "near" radius ---------------------------------------------------------------

def test_the_near_radius_setting_is_used(client):
    client.post("/reminders", json={"id": "p", "title": "Pick up meds", "triggerType": "location",
                                    "location": {"type": "category", "category": "pharmacy"}})
    ctx = {"nearbyPlaces": [{"name": "CVS", "types": ["pharmacy"], "distanceMeters": 250}]}
    assert client.post("/evaluate-reminder", json={"reminderId": "p", "context": ctx}).json()["location"]["matched"] is False
    patch(client, nearRadiusMeters=300)
    assert client.post("/evaluate-reminder", json={"reminderId": "p", "context": ctx}).json()["location"]["matched"] is True


# ---- privacy switches ------------------------------------------------------------

def test_turning_keep_what_i_said_off_erases_the_past_and_stops_the_future(client, monkeypatch):
    client.post("/sessions/parse", json={"text": "remind me to call mom", "sessionId": "s"})
    assert patch(client, keepTranscripts=False).json()["keepTranscripts"] is False
    db = db_of(client)
    assert all(r.source_text is None for r in db.exec(select(ReminderRow)))        # the past
    client.post("/sessions/parse", json={"text": "remind me to buy eggs", "sessionId": "s"})
    assert all(r.source_text is None for r in db_of(client).exec(select(ReminderRow)))  # the future
    assert client.get("/privacy").json()["storeTranscripts"] is False
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("down")))
    assert client.post("/sessions/parse", json={"text": "x", "sessionId": "s"}).status_code == 503  # can't queue words


def test_turning_it_back_on_keeps_new_words_again(client):
    patch(client, keepTranscripts=False)
    patch(client, keepTranscripts=True)
    client.post("/sessions/parse", json={"text": "remind me to water plants", "sessionId": "s"})
    assert db_of(client).exec(select(ReminderRow)).first().source_text == "remind me to water plants"


def test_a_person_cannot_loosen_what_the_server_forbids(client, monkeypatch):
    monkeypatch.setattr(config, "STORE_TRANSCRIPTS", False)
    s = patch(client, keepTranscripts=True).json()
    assert s["keepTranscripts"] is True and s["serverKeepsTranscripts"] is False  # the app can explain why
    client.post("/sessions/parse", json={"text": "remind me to call mom", "sessionId": "s"})
    assert db_of(client).exec(select(ReminderRow)).first().source_text is None


def test_a_shorter_keep_period_applies_to_existing_words_now(client, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 30)
    db = db_of(client)
    db.add_all([ReminderRow(id="old", title="t", trigger_type="time", source_text="ten days old", created_at=utcnow() - timedelta(days=10)),
                ReminderRow(id="new", title="t", trigger_type="time", source_text="from today")])
    db.commit()
    patch(client, deleteTranscriptsAfterDays=7)
    db = db_of(client)
    assert db.get(ReminderRow, "old").source_text is None and db.get(ReminderRow, "new").source_text == "from today"
    assert client.get("/privacy").json()["transcriptRetentionDays"] == 7


def test_a_longer_keep_period_than_the_server_allows_has_no_effect(client, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 30)
    patch(client, deleteTranscriptsAfterDays=90)
    assert client.get("/privacy").json()["transcriptRetentionDays"] == 30


def test_your_times_of_day_also_reach_the_model_for_typed_input(client, monkeypatch):
    prompts = []
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: prompts.append(m[0]["content"]) or {"reminders": []})
    patch(client, timesOfDay={"morning": "07:15"})
    client.post("/parse", json={"text": "call the bank tomorrow morning"})
    assert "is 07:15 tomorrow" in prompts[0] and "is 07:15 that day" in prompts[0]
