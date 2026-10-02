from datetime import timedelta

import pytest

from app import config, llm, sessions
from app.models import utcnow

T0 = utcnow()


@pytest.fixture()
def clock(monkeypatch):
    """A clock the test can move: clock.now = T0 + timedelta(...)."""

    class Clock:
        now = T0

    monkeypatch.setattr(sessions, "_now", lambda: Clock.now)
    monkeypatch.setattr(config, "SESSION_SILENCE_TIMEOUT_S", 120)
    monkeypatch.setattr(config, "SESSION_MAX_DURATION_S", 1800)
    return Clock


def chunk(client, sid, text="remind me to call Mom"):
    return client.post("/sessions/parse", json={"text": text, "sessionId": sid})


def test_start_returns_a_listening_session(client, clock):
    r = client.post("/sessions")
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "listening" and body["id"] and "endedAt" not in body


def test_first_chunk_starts_the_session_automatically(client, clock):
    assert chunk(client, "auto").status_code == 200
    assert client.get("/sessions/auto").json()["status"] == "listening"


def test_end_by_user_returns_the_review_list(client, clock):
    sid = client.post("/sessions").json()["id"]
    chunk(client, sid, "remind me to call Mom")
    chunk(client, sid, "remind me to buy eggs")
    ended = client.post(f"/sessions/{sid}/end").json()
    assert ended["status"] == "ended" and ended["endReason"] == "user"
    assert len(ended["reminders"]) == 2


def test_ending_twice_keeps_the_first_reason(client, clock):
    sid = client.post("/sessions").json()["id"]
    first = client.post(f"/sessions/{sid}/end").json()
    clock.now = T0 + timedelta(hours=2)  # would now count as a timeout
    again = client.post(f"/sessions/{sid}/end").json()
    assert again["endReason"] == "user" and again["endedAt"] == first["endedAt"]


def test_silence_timeout_ends_the_session_lazily(client, clock):
    sid = client.post("/sessions").json()["id"]
    chunk(client, sid)
    clock.now = T0 + timedelta(seconds=119)
    assert client.get(f"/sessions/{sid}").json()["status"] == "listening"
    clock.now = T0 + timedelta(seconds=121)
    body = client.get(f"/sessions/{sid}").json()
    assert body["status"] == "ended" and body["endReason"] == "silence_timeout"
    # it ended when it went quiet, not when we looked
    assert body["endedAt"].startswith((T0 + timedelta(seconds=120)).strftime("%Y-%m-%dT%H:%M:%S"))
    assert len(body["reminders"]) == 1  # what was captured is kept for review


def test_each_chunk_resets_the_silence_timer(client, clock):
    sid = client.post("/sessions").json()["id"]
    for minute in range(1, 6):
        clock.now = T0 + timedelta(seconds=100 * minute)
        assert chunk(client, sid, f"remind me to do thing {minute}").status_code == 200
    assert client.get(f"/sessions/{sid}").json()["status"] == "listening"


def test_max_duration_ends_even_while_chunks_keep_arriving(client, clock):
    sid = client.post("/sessions").json()["id"]
    t = T0
    while t < T0 + timedelta(seconds=1790):
        t += timedelta(seconds=60)
        clock.now = t
        chunk(client, sid, f"remind me to do thing at {t:%H%M%S}")
    clock.now = T0 + timedelta(seconds=1801)
    body = client.get(f"/sessions/{sid}").json()
    assert body["status"] == "ended" and body["endReason"] == "max_duration"


def test_chunk_to_an_ended_session_is_409_and_saves_nothing(client, clock):
    sid = client.post("/sessions").json()["id"]
    client.post(f"/sessions/{sid}/end")
    r = chunk(client, sid)
    assert r.status_code == 409
    assert client.get(f"/sessions/{sid}").json()["reminders"] == []


def test_chunk_after_timeout_is_409(client, clock):
    sid = client.post("/sessions").json()["id"]
    chunk(client, sid)
    clock.now = T0 + timedelta(seconds=500)
    assert chunk(client, sid).status_code == 409


def test_unknown_session_is_404(client, clock):
    assert client.get("/sessions/nope").status_code == 404
    assert client.post("/sessions/nope/end").status_code == 404


def test_repeated_commitment_is_saved_once_per_session(client, clock):
    sid = client.post("/sessions").json()["id"]
    first = chunk(client, sid, "remind me to call Mom").json()
    again = chunk(client, sid, "remind me to call Mom").json()
    assert len(first["reminders"]) == 1 and again["reminders"] == []
    assert len(client.get(f"/sessions/{sid}").json()["reminders"]) == 1


def test_same_commitment_in_a_different_session_is_kept(client, clock):
    a = chunk(client, "s-a", "remind me to call Mom").json()
    b = chunk(client, "s-b", "remind me to call Mom").json()
    assert len(a["reminders"]) == 1 and len(b["reminders"]) == 1


def test_a_failed_chunk_still_counts_as_activity_and_is_queued_not_saved(client, clock, monkeypatch):
    sid = client.post("/sessions").json()["id"]
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("x")))
    clock.now = T0 + timedelta(seconds=100)
    assert chunk(client, sid, "chatter").status_code == 202
    clock.now = T0 + timedelta(seconds=200)  # 100s after the failed chunk, 200s after start
    assert client.get(f"/sessions/{sid}").json()["status"] == "listening"
    assert client.get(f"/sessions/{sid}").json()["reminders"] == []


def test_session_endpoints_need_the_api_key_when_set(client, clock, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.post("/sessions").status_code == 401
    assert client.post("/sessions", headers={"X-API-Key": "secret"}).status_code == 201


def test_dedupe_tolerates_small_deadline_drift_but_not_a_different_time(client, clock, monkeypatch):
    from datetime import datetime, timezone

    from app.models import ReminderCreate

    def parse_to(deadline):
        c = ReminderCreate(title="Call Mom", trigger_type="time", deadline=deadline)
        monkeypatch.setattr("app.parser.parse", lambda *a, **k: [c])

    base = datetime(2026, 10, 2, 14, 0, tzinfo=timezone.utc)
    sid = client.post("/sessions").json()["id"]
    parse_to(base)
    assert len(chunk(client, sid).json()["reminders"]) == 1
    parse_to(base + timedelta(seconds=40))  # "in 30 minutes" said again a moment later
    assert chunk(client, sid).json()["reminders"] == []
    parse_to(base + timedelta(hours=3))  # genuinely a different time
    assert len(chunk(client, sid).json()["reminders"]) == 1
    parse_to(None)  # same words, no time at all, is a different reminder
    assert len(chunk(client, sid).json()["reminders"]) == 1
