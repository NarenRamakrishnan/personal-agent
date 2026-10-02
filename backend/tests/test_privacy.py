import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

from app import chunks, config, llm, parser, retention, sessions
from app.db import get_session
from app.main import app
from app.models import ActionRow, PendingChunkRow, ReminderRow, utcnow

T0 = utcnow()


@pytest.fixture()
def clock(monkeypatch):
    class Clock:
        now = T0

    monkeypatch.setattr(sessions, "_now", lambda: Clock.now)
    monkeypatch.setattr(config, "SESSION_SILENCE_TIMEOUT_S", 120)
    monkeypatch.setattr(config, "SESSION_MAX_DURATION_S", 1800)
    return Clock


class Model:
    """A stand-in for Nemotron that can go down and come back."""

    def __init__(self, up=True):
        self.up, self.calls = up, []

    def __call__(self, messages, model=None):
        self.calls.append(messages[-1]["content"])
        if not self.up:
            raise llm.LLMError("down")
        text = messages[-1]["content"]
        if "email draft" in messages[0]["content"]:
            return {"email": {"toName": "Alex", "to": None, "subject": "Hi", "body": "Hello."}}
        return {"reminders": [{"title": text.upper(), "triggerType": "time"}]}


@pytest.fixture()
def model(monkeypatch):
    m = Model(up=True)
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", m)
    return m


def db_of(client):
    return Session(next(app.dependency_overrides[get_session]()).get_bind())


def chunk(client, sid, text, **extra):
    return client.post("/sessions/parse", json={"text": text, "sessionId": sid, **extra})


# ---- failed chunks are queued, not lost ----------------------------------

def test_failed_chunk_is_queued_then_recovered_on_retry(client, model):
    sid = client.post("/sessions").json()["id"]
    model.up = False
    r = chunk(client, sid, "call mom")
    assert r.status_code == 202 and r.json()["pendingChunks"] == 1 and r.json()["reminders"] == []
    assert client.get(f"/sessions/{sid}").json()["pendingChunks"] == 1
    model.up = True
    done = client.post(f"/sessions/{sid}/retry").json()
    assert done["pendingChunks"] == 0 and [x["title"] for x in done["reminders"]] == ["CALL MOM"]


def test_ending_the_session_retries_what_the_model_missed(client, model):
    sid = client.post("/sessions").json()["id"]
    model.up = False
    chunk(client, sid, "buy eggs")
    model.up = True
    ended = client.post(f"/sessions/{sid}/end").json()
    assert ended["status"] == "ended" and ended["pendingChunks"] == 0
    assert [x["title"] for x in ended["reminders"]] == ["BUY EGGS"]


def test_retry_goes_in_capture_order_and_stops_at_the_first_failure(client, model, monkeypatch):
    sid = client.post("/sessions").json()["id"]
    model.up = False
    for i, text in enumerate(["first", "second", "third"]):
        chunk(client, sid, text, now=(T0 + timedelta(seconds=i)).isoformat())
    seen, fail_at = [], {"n": 2}

    def flaky(messages, model_name=None):
        seen.append(messages[-1]["content"])
        if len(seen) == fail_at["n"]:  # the SECOND attempt fails, with a third chunk still waiting
            raise llm.LLMError("down again")
        return {"reminders": [{"title": messages[-1]["content"].upper(), "triggerType": "time"}]}

    monkeypatch.setattr(llm, "chat_json", flaky)
    left = client.post(f"/sessions/{sid}/retry").json()
    assert seen == ["first", "second"]                    # oldest first, and "third" was NOT attempted
    assert left["pendingChunks"] == 2                      # second and third are still waiting
    assert [x["title"] for x in left["reminders"]] == ["FIRST"]
    seen.clear()
    fail_at["n"] = None
    done = client.post(f"/sessions/{sid}/retry").json()    # model is fine now: the rest go through in order
    assert seen == ["second", "third"] and done["pendingChunks"] == 0


def test_retry_uses_the_time_the_speech_was_captured(client, monkeypatch):
    sid = client.post("/sessions").json()["id"]
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", Model(up=False))
    captured = T0 - timedelta(minutes=45)
    chunk(client, sid, "remind me tomorrow", now=captured.isoformat())
    nows = []
    real = parser.parse
    monkeypatch.setattr(parser, "parse", lambda text, now, *a, **k: (nows.append(now), real(text, now, *a, **k))[1])
    monkeypatch.setattr(llm, "chat_json", Model(up=True))
    client.post(f"/sessions/{sid}/retry")
    assert nows and abs(nows[0] - captured) < timedelta(seconds=1)  # not the retry time


def test_a_good_chunk_also_clears_a_little_of_the_backlog(client, model):
    sid = client.post("/sessions").json()["id"]
    model.up = False
    chunk(client, sid, "old one")
    model.up = True
    r = chunk(client, sid, "new one").json()
    assert r["pendingChunks"] == 0
    titles = sorted(x["title"] for x in client.get(f"/sessions/{sid}").json()["reminders"])
    assert titles == ["NEW ONE", "OLD ONE"]


def test_retry_on_an_ended_session_works(client, model, clock):
    sid = client.post("/sessions").json()["id"]
    model.up = False
    chunk(client, sid, "lost words")
    clock.now = T0 + timedelta(seconds=500)  # session timed out meanwhile
    model.up = True
    assert client.post(f"/sessions/{sid}/retry").json()["reminders"][0]["title"] == "LOST WORDS"


def test_when_transcripts_cannot_be_stored_a_failed_chunk_is_a_503(client, model, monkeypatch):
    monkeypatch.setattr(config, "STORE_TRANSCRIPTS", False)
    model.up = False
    assert chunk(client, "s", "secret words").status_code == 503
    assert client.get("/privacy").json()["counts"]["pendingChunks"] == 0


# ---- late chunks from a phone that lost signal ---------------------------

def test_a_buffered_chunk_spoken_during_the_session_is_still_accepted(client, model, clock):
    sid = client.post("/sessions").json()["id"]
    clock.now = T0 + timedelta(seconds=60)
    ended = client.post(f"/sessions/{sid}/end").json()
    late = chunk(client, sid, "said while offline", capturedAt=(T0 + timedelta(seconds=30)).isoformat())
    assert late.status_code == 200 and len(late.json()["reminders"]) == 1
    after = client.get(f"/sessions/{sid}").json()
    assert after["status"] == "ended" and after["endedAt"] == ended["endedAt"]  # session not reopened


def test_a_chunk_captured_after_the_end_is_still_refused(client, model, clock):
    sid = client.post("/sessions").json()["id"]
    clock.now = T0 + timedelta(seconds=60)
    client.post(f"/sessions/{sid}/end")
    assert chunk(client, sid, "x", capturedAt=(T0 + timedelta(seconds=90)).isoformat()).status_code == 409
    assert chunk(client, sid, "x").status_code == 409  # no capture time: unknown, so refuse
    assert chunk(client, sid, "x", capturedAt=(T0 - timedelta(hours=1)).isoformat()).status_code == 409


def test_a_timed_out_session_accepts_chunks_from_before_it_went_quiet(client, model, clock):
    sid = client.post("/sessions").json()["id"]
    chunk(client, sid, "first")
    clock.now = T0 + timedelta(seconds=600)
    ok = chunk(client, sid, "buffered", capturedAt=(T0 + timedelta(seconds=50)).isoformat())
    assert ok.status_code == 200
    assert client.get(f"/sessions/{sid}").json()["endReason"] == "silence_timeout"


def test_capturedat_must_carry_a_timezone(client, model):
    assert chunk(client, "s", "x", capturedAt="2026-10-02T12:00:00").status_code == 422


# ---- privacy controls ----------------------------------------------------

def seed(client, model, sid="s1"):
    chunk(client, sid, "remind me one")
    r = client.post("/actions/email", json={"text": "email Alex hi", "sessionId": sid})
    return r


def test_privacy_info_states_facts_and_counts(client, model):
    seed(client, model)
    p = client.get("/privacy").json()
    assert p["audioStored"] is False and p["storeTranscripts"] is True
    assert p["transcriptRetentionDays"] == config.TRANSCRIPT_RETENTION_DAYS
    assert p["counts"]["sessions"] == 1 and p["counts"]["reminders"] == 1
    assert p["counts"]["remindersWithTranscript"] == 1 and p["counts"]["actions"] == 1


def test_delete_transcript_keeps_the_reminders(client, model):
    seed(client, model)
    out = client.delete("/sessions/s1/transcript").json()
    assert out["transcriptsErased"] >= 1
    review = client.get("/sessions/s1").json()
    assert len(review["reminders"]) == 1 and "sourceText" not in review["reminders"][0]
    assert "sourceText" not in review["actions"][0]
    assert client.get("/privacy").json()["counts"]["remindersWithTranscript"] == 0


def test_delete_transcript_also_clears_queued_chunks(client, model):
    model.up = False
    chunk(client, "s2", "private words")
    out = client.delete("/sessions/s2/transcript").json()
    assert out["pendingChunksDeleted"] == 1
    assert client.get("/privacy").json()["counts"]["pendingChunks"] == 0


def test_delete_session_removes_everything_it_made_and_nothing_else(client, model):
    seed(client, model, "keep")
    seed(client, model, "gone")
    model.up = False
    chunk(client, "gone", "queued")
    assert client.delete("/sessions/gone").status_code == 204
    counts = client.get("/privacy").json()["counts"]
    assert counts == {**counts, "sessions": 1, "reminders": 1, "actions": 1, "pendingChunks": 0}
    assert client.get("/sessions/gone").status_code == 404 and client.delete("/sessions/gone").status_code == 404
    assert client.get("/sessions/keep").status_code == 200


def test_delete_history_needs_the_confirm_word(client, model):
    seed(client, model)
    assert client.delete("/history").status_code == 400
    assert client.delete("/history", params={"confirm": "yes"}).status_code == 400
    assert client.get("/privacy").json()["counts"]["reminders"] == 1  # untouched


def test_delete_history_wipes_data_but_keeps_saved_places_unless_asked(client, model):
    seed(client, model)
    client.put("/saved-places/home", json={"name": "home", "latitude": 42.0, "longitude": -72.0})
    out = client.delete("/history", params={"confirm": "delete-everything"}).json()["deleted"]
    assert out["reminders"] == 1 and out["actions"] == 1 and out["sessions"] == 1 and "savedPlaces" not in out
    counts = client.get("/privacy").json()["counts"]
    assert (counts["reminders"], counts["actions"], counts["sessions"], counts["savedPlaces"]) == (0, 0, 0, 1)
    out = client.delete("/history", params={"confirm": "delete-everything", "savedPlaces": "true"}).json()["deleted"]
    assert out["savedPlaces"] == 1 and client.get("/privacy").json()["counts"]["savedPlaces"] == 0


def test_not_storing_transcripts_means_no_source_text_anywhere(client, model, monkeypatch):
    monkeypatch.setattr(config, "STORE_TRANSCRIPTS", False)
    seed(client, model)
    review = client.get("/sessions/s1").json()
    assert "sourceText" not in review["reminders"][0] and "sourceText" not in review["actions"][0]
    assert client.get("/privacy").json()["storeTranscripts"] is False


def test_privacy_endpoints_need_the_api_key_when_set(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    for call in (client.get("/privacy"), client.delete("/history?confirm=delete-everything"), client.delete("/sessions/x")):
        assert call.status_code == 401


# ---- retention -----------------------------------------------------------

def test_expired_transcripts_are_erased_but_the_reminders_stay(client, model, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 30)
    seed(client, model)
    db = db_of(client)
    old = db.exec(__import__("sqlmodel").select(ReminderRow)).first()
    old.created_at = utcnow() - timedelta(days=40)
    db.add(old)
    db.add(PendingChunkRow(session_id="s1", text="stale", created_at=utcnow() - timedelta(days=40)))
    db.commit()
    result = retention.purge_expired(db)
    assert result == {"transcripts_erased": 1, "pending_deleted": 1}
    assert db.get(ReminderRow, old.id).source_text is None  # words gone
    assert db.get(ReminderRow, old.id).title                # reminder kept
    assert db.exec(__import__("sqlmodel").select(ActionRow)).first().source_text is not None  # newer, untouched


def test_retention_zero_keeps_everything(client, model, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 0)
    seed(client, model)
    db = db_of(client)
    row = db.exec(__import__("sqlmodel").select(ReminderRow)).first()
    row.created_at = utcnow() - timedelta(days=4000)
    db.add(row)
    db.commit()
    assert retention.purge_expired(db) == {"transcripts_erased": 0, "pending_deleted": 0}


# ---- logs never contain what the person said ------------------------------

CANARY = "zebra-canary-93817"


def test_no_request_text_reaches_the_logs_on_any_path(client, model, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    text = f"remind me about {CANARY}"
    chunk(client, "s", text)                                              # success
    model.up = False
    chunk(client, "s", f"{text} while the model is down")                  # failure + queue
    client.post("/parse", json={"text": text})                            # typed fallback
    client.post("/actions/email", json={"text": f"email Alex {CANARY}"})  # drafting failure
    client.post("/parse", json={"text": CANARY * 1000})                   # too long -> 422
    client.post("/reminders", content=f'{{"title": "{CANARY}", "triggerType": 5}}', headers={"content-type": "application/json"})
    client.post("/evaluate-reminder", json={"reminder": {"title": CANARY}})
    monkeypatch.setattr(parser, "parse", lambda *a, **k: (_ for _ in ()).throw(RuntimeError(f"boom {CANARY}")))
    boom = client.post("/parse", json={"text": text})                     # unexpected crash
    assert boom.status_code == 500 and CANARY not in boom.text            # generic error body
    assert CANARY not in caplog.text
    assert all(CANARY not in str(a) for r in caplog.records for a in (r.args if isinstance(r.args, tuple) else ()))
    assert any("unhandled RuntimeError" in r.getMessage() for r in caplog.records)  # still diagnosable


# ---- malformed input never produces a 500 -------------------------------

BAD_BODIES = [
    b"", b"{not json", b"[]", b"null", b"5", b'"a string"', b'{"text": null}', b'{"text": 5}',
    b'{"text": ["a"]}', b'{"text": {"a": 1}}', b'{"title": 5, "triggerType": []}',
    json.dumps({"text": "x" * 6000}).encode(), json.dumps({"title": "x" * 6000, "triggerType": "time"}).encode(),
    json.dumps({"text": "\x00\x00"}).encode(), json.dumps({"text": "😀 ‮ rtl ​ zero-width"}).encode(),
    b'{"a":' * 200 + b"1" + b"}" * 200, json.dumps({"deadline": "not-a-date", "title": "t", "triggerType": "time"}).encode(),
    json.dumps({"latitude": 1e999}).encode(), json.dumps({"reminder": {}, "reminderId": 5}).encode(),
]
ENDPOINTS = [
    ("post", "/reminders"), ("patch", "/reminders/x"), ("post", "/parse"), ("post", "/sessions/parse"),
    ("post", "/actions/email"), ("patch", "/actions/x"), ("put", "/saved-places/home"), ("post", "/evaluate-reminder"),
]


@pytest.mark.parametrize("method, path", ENDPOINTS)
@pytest.mark.parametrize("body", BAD_BODIES, ids=lambda b: b[:24].decode("utf-8", "replace"))
def test_malformed_bodies_are_rejected_not_crashed(client, model, method, path, body):
    r = getattr(client, method)(path, content=body, headers={"content-type": "application/json"})
    assert r.status_code < 500, (method, path, r.status_code, r.text[:200])


@pytest.mark.parametrize("query", ["limit=abc", "limit=-1", "limit=99999", "offset=-5", "sessionId=" + "a" * 5000])
def test_malformed_query_strings_are_rejected_not_crashed(client, query):
    assert client.get(f"/reminders?{query}").status_code < 500


def test_wrong_content_type_and_methods_are_clean_errors(client):
    assert client.post("/parse", content="text=hi", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 422
    assert client.put("/parse").status_code == 405
    assert client.post("/does-not-exist").status_code == 404


def test_unicode_text_round_trips_and_nul_is_stripped(client, model):
    wild = "remind me \U0001F600 ‮​ café 大学"
    r = client.post("/sessions/parse", json={"text": wild + "\x00", "sessionId": "u"})
    assert r.status_code == 200 and r.json()["reminders"][0]["sourceText"] == wild
