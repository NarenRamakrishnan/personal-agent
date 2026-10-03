"""One regression test per finding from the second code review."""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event
from sqlmodel import Session, select

from app import chunks, config, emailer, llm, parser, retention, scoring, usage
from app.db import get_session, init_db, make_engine
from app.main import app
from app.models import Location, PendingChunkRow, Reminder, ReminderRow, utcnow

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
ISO = "2026-10-02T12:00:00Z"


def db_of(client):
    return Session(next(app.dependency_overrides[get_session]()).get_bind())


# ---- 1. naive timestamps on an inline reminder --------------------------

@pytest.mark.parametrize("field", ["createdAt", "lastNotifiedAt", "snoozedUntil"])
def test_inline_reminder_with_a_naive_timestamp_is_422_not_500(client, field):
    body = {"id": "x", "title": "t", "triggerType": "time", "createdAt": ISO, "completed": False, field: "2026-10-01T11:00:00"}
    r = client.post("/evaluate-reminder", json={"reminder": body, "context": {"now": ISO}})
    assert r.status_code == 422


# ---- 2. retention runs on a long-lived server ----------------------------

def test_maybe_purge_runs_then_waits_an_hour(client, monkeypatch):
    monkeypatch.setattr(retention, "_last_run", None)
    calls = []
    monkeypatch.setattr(retention, "purge_expired", lambda db, now=None: calls.append(1) or {})
    clock = {"t": 1000.0}
    monkeypatch.setattr(retention.time, "monotonic", lambda: clock["t"])
    db = db_of(client)
    assert retention.maybe_purge(db) == {} and len(calls) == 1
    clock["t"] += 3599
    assert retention.maybe_purge(db) is None and len(calls) == 1
    clock["t"] += 2
    retention.maybe_purge(db)
    assert len(calls) == 2


def test_starting_a_session_triggers_the_hourly_purge_and_a_failure_does_not_break_it(client, monkeypatch):
    monkeypatch.setattr(retention, "_last_run", None)
    monkeypatch.setattr(retention, "purge_expired", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.post("/sessions").status_code == 201  # purge exploded; session still starts


def test_a_long_running_server_expires_old_transcripts_without_a_restart(client, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 30)
    monkeypatch.setattr(retention, "_last_run", None)
    db = db_of(client)
    db.add(ReminderRow(id="old", title="t", trigger_type="time", source_text="old words", created_at=utcnow() - timedelta(days=40)))
    db.commit()
    client.post("/sessions")  # the only thing that happens: a new session starts
    assert db.exec(select(ReminderRow)).first().source_text is None


# ---- 3. config never fails open ------------------------------------------

@pytest.mark.parametrize("raw", ["off", "OFF", "disabled", "n", "no", "0", "false", " false "])
def test_every_off_spelling_turns_transcript_storage_off(monkeypatch, raw):
    monkeypatch.setenv("X_FLAG", raw)
    assert config._env_bool("X_FLAG", True) is False


@pytest.mark.parametrize("raw", ["on", "1", "true", "yes", "y"])
def test_on_spellings(monkeypatch, raw):
    monkeypatch.setenv("X_FLAG", raw)
    assert config._env_bool("X_FLAG", False) is True


@pytest.mark.parametrize("raw", ["ture", "maybe", "2", "offf"])
def test_an_unrecognised_spelling_stops_startup(monkeypatch, raw):
    monkeypatch.setenv("X_FLAG", raw)
    with pytest.raises(ValueError, match="X_FLAG"):
        config._env_bool("X_FLAG", True)


def test_unset_or_blank_uses_the_default(monkeypatch):
    monkeypatch.delenv("X_FLAG", raising=False)
    assert config._env_bool("X_FLAG", True) is True
    monkeypatch.setenv("X_FLAG", "  ")
    assert config._env_bool("X_FLAG", False) is False


@pytest.mark.parametrize("raw", ["-1", "abc", "1.5"])
def test_bad_numbers_stop_startup_instead_of_meaning_forever(monkeypatch, raw):
    monkeypatch.setenv("X_NUM", raw)
    with pytest.raises(ValueError, match="X_NUM"):
        config._env_int("X_NUM", 30)


# ---- 4. the spend cap holds under concurrency, and a broken counter fails closed

def test_the_daily_call_cap_holds_exactly_under_concurrency(tmp_path, monkeypatch):
    eng = make_engine(f"sqlite:///{tmp_path}/u.db")
    init_db(eng)
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", 40)
    monkeypatch.setattr(config, "LLM_DAILY_TOKEN_LIMIT", 0)

    def attempt(_):
        try:
            usage._reserve_in_db(eng)  # the part that must be atomic (the lock is per process)
            return 1
        except usage.BudgetExceeded:
            return 0

    with ThreadPoolExecutor(max_workers=12) as pool:
        granted = sum(pool.map(attempt, range(120)))
    assert granted == 40 and usage.snapshot(eng)["calls"] == 40


def test_the_token_cap_also_holds_concurrently(tmp_path, monkeypatch):
    eng = make_engine(f"sqlite:///{tmp_path}/t.db")
    init_db(eng)
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", 0)
    monkeypatch.setattr(config, "LLM_DAILY_TOKEN_LIMIT", 100)
    usage.record_tokens(100, eng)
    with pytest.raises(usage.BudgetExceeded, match="token"):
        usage._reserve_in_db(eng)


def test_first_call_of_the_day_race_is_harmless(tmp_path, monkeypatch):
    eng = make_engine(f"sqlite:///{tmp_path}/r.db")
    init_db(eng)
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", 1000)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: usage._reserve_in_db(eng), range(8)))
    assert usage.snapshot(eng)["calls"] == 8


def test_a_broken_spend_counter_fails_closed_as_an_llm_error(client, monkeypatch):
    monkeypatch.setattr(usage, "reserve_call", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    with pytest.raises(llm.LLMError):
        llm.chat_json([{"role": "user", "content": "x"}])
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    assert client.post("/parse", json={"text": "call the bank"}).status_code == 200      # typed fallback still works
    assert client.post("/sessions/parse", json={"text": "chatter", "sessionId": "s"}).status_code == 202  # queued, not lost


# ---- 5. capture time beats send time -------------------------------------

def test_relative_words_resolve_against_when_the_speech_was_captured(client, monkeypatch):
    seen = []
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")

    def fake(text, now, session_id, tz_name=None, fallback=True, **kw):
        seen.append(now)
        return []

    monkeypatch.setattr(parser, "parse", fake)
    client.post("/sessions/parse", json={"text": "tonight call mom", "sessionId": "s",
                                         "now": "2026-10-02T05:00:00Z", "capturedAt": "2026-10-01T21:00:00Z"})
    assert seen == [datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc)]


def test_a_queued_chunk_remembers_the_capture_time_not_the_send_time(client, monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("down")))
    client.post("/sessions/parse", json={"text": "later", "sessionId": "s",
                                         "now": "2026-10-02T05:00:00Z", "capturedAt": "2026-10-01T21:00:00Z"})
    stored = db_of(client).exec(select(PendingChunkRow)).one()
    assert stored.captured_at == datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc)


# ---- 6. retries claim a chunk and save atomically --------------------------

def queued(client, monkeypatch, text="queued words"):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("down")))
    client.post("/sessions/parse", json={"text": text, "sessionId": "s"})
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: {"reminders": [{"title": "Done", "triggerType": "time"}]})
    return db_of(client)


def test_a_chunk_can_only_be_claimed_once_until_the_claim_goes_stale(client, monkeypatch):
    db = queued(client, monkeypatch)
    cid = db.exec(select(PendingChunkRow.id)).one()
    assert chunks._claim(db, cid) is True and chunks._claim(db, cid) is False
    row = db.get(PendingChunkRow, cid)
    row.claimed_at = utcnow() - chunks.CLAIM_TTL - timedelta(seconds=1)  # the claimer died
    db.add(row)
    db.commit()
    assert chunks._claim(db, cid) is True


def test_retry_skips_a_chunk_someone_else_is_processing(client, monkeypatch):
    db = queued(client, monkeypatch)
    calls = []
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: calls.append(1) or {"reminders": []})
    chunks._claim(db, db.exec(select(PendingChunkRow.id)).one())  # another caller holds it
    assert chunks.retry_pending(db, "s") == 1 and calls == []     # not parsed twice, not lost


def test_a_failed_retry_releases_the_claim_so_it_can_be_tried_again(client, monkeypatch):
    db = queued(client, monkeypatch)
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("down")))
    assert chunks.retry_pending(db, "s") == 1
    assert db.exec(select(PendingChunkRow)).one().claimed_at is None


def test_a_crash_while_saving_leaves_the_chunk_queued_and_nothing_half_saved(client, monkeypatch):
    db = queued(client, monkeypatch)
    monkeypatch.setattr(chunks, "row_from_create", lambda c: (_ for _ in ()).throw(RuntimeError("disk")))
    assert chunks.retry_pending(db, "s") == 1                         # still queued
    assert db.exec(select(PendingChunkRow)).one().claimed_at is None  # and free to retry
    assert db.exec(select(ReminderRow)).all() == []
    monkeypatch.undo()


def test_chunk_removal_and_its_reminders_land_together(client, monkeypatch):
    db = queued(client, monkeypatch)
    assert chunks.retry_pending(db, "s") == 0
    assert [r.title for r in db.exec(select(ReminderRow))] == ["Done"]


def test_a_backlog_retry_that_explodes_does_not_turn_a_saved_chunk_into_a_500(client, monkeypatch):
    queued(client, monkeypatch)
    monkeypatch.setattr(chunks, "retry_pending", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    r = client.post("/sessions/parse", json={"text": "fresh words", "sessionId": "s"})
    assert r.status_code == 200 and [x["title"] for x in r.json()["reminders"]] == ["Done"]


# ---- 7. a spoken address must match whole ---------------------------------

SPOKEN = "email john.smith@gmail.com that I'm late"


@pytest.mark.parametrize("model_says", ["smith@gmail.com", "n.smith@gmail.com", "john.smith@gmail.co", "john.smith@gmail.com.evil.io", "xjohn.smith@gmail.com"])
def test_a_fragment_or_extension_of_a_spoken_address_is_dropped(model_says):
    assert emailer._spoken_address(model_says, SPOKEN) is None


@pytest.mark.parametrize("text", [SPOKEN, "send john.smith@gmail.com. Thanks", "email (john.smith@gmail.com), please", "EMAIL JOHN.SMITH@GMAIL.COM now"])
def test_the_whole_spoken_address_is_kept_whatever_surrounds_it(text):
    assert emailer._spoken_address("john.smith@gmail.com", text) == "john.smith@gmail.com"


def test_with_two_spoken_addresses_either_is_accepted_and_a_third_is_not():
    text = "email a.one@x.com and b.two@y.org"
    assert emailer._spoken_address("b.two@y.org", text) == "b.two@y.org"
    assert emailer._spoken_address("c.three@z.net", text) is None


# ---- 8. only a real change withdraws approval -----------------------------

def approved_draft(client, monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: {"email": {"toName": "Alex", "subject": "Hi", "body": "Hello."}})
    aid = client.post("/actions/email", json={"text": "email Alex hi"}).json()["id"]
    client.post(f"/actions/{aid}/approve")
    return aid


@pytest.mark.parametrize("patch", [{}, {"subject": "Hi"}, {"body": "Hello."}, {"toName": "Alex"}, {"to": None}])
def test_a_no_op_edit_keeps_the_approval(client, monkeypatch, patch):
    aid = approved_draft(client, monkeypatch)
    assert client.patch(f"/actions/{aid}", json=patch).json()["status"] == "approved"


@pytest.mark.parametrize("patch", [{"subject": "Different"}, {"body": "Other."}, {"to": "a@b.co"}, {"toName": "Sam"}])
def test_a_real_edit_withdraws_it(client, monkeypatch, patch):
    aid = approved_draft(client, monkeypatch)
    assert client.patch(f"/actions/{aid}", json=patch).json()["status"] == "needs_approval"


def test_overlong_recipient_is_rejected_not_silently_trimmed(client, monkeypatch):
    aid = approved_draft(client, monkeypatch)
    long_addr = "a" * 320 + "@b.co"
    assert client.patch(f"/actions/{aid}", json={"to": long_addr}).status_code == 422
    assert client.patch(f"/actions/{aid}", json={"toName": "n" * 201}).status_code == 422


# ---- 9. time_and_location needs both -------------------------------------

UTC = ZoneInfo("UTC")


def tl(deadline_minutes, trigger="time_and_location", **kw):
    return Reminder(id="r", title="t", trigger_type=trigger, created_at=NOW - timedelta(days=9),
                    location=Location(type="category", category="pharmacy"),
                    deadline=NOW + timedelta(minutes=deadline_minutes), **kw)


@pytest.mark.parametrize("name, r, score, notify", [
    ("deadline in 5 days: the place alone does not fire it", tl(5 * 24 * 60), 10, False),
    ("deadline tomorrow", tl(24 * 60), 10, False),
    ("deadline later today: place counts", tl(300), 75, True),
    ("deadline within 2h: place counts", tl(60), 105, True),
    ("deadline passed yesterday: place counts", tl(-(24 * 60 + 30)), 60, True),
    ("a location-only reminder keeps firing on the place alone", tl(5 * 24 * 60, trigger="location"), 60, True),
])
def test_time_and_location_waits_for_the_deadline_day(name, r, score, notify):
    d = scoring.decide(r, NOW, True, UTC)
    assert (d["score"], d["notify"]) == (score, notify), name


def test_the_withheld_place_is_explained(client):
    d = scoring.decide(tl(5 * 24 * 60), NOW, True, UTC)
    assert {"label": "place matches but the deadline is on a later day", "points": 0} in d["reasons"]


# ---- 10. counting and deleting cost the same however much data there is ----

def statements(client, call):
    eng = db_of(client).get_bind()
    log = []
    listener = lambda conn, cur, stmt, *a: log.append(stmt)  # noqa: E731
    event.listen(eng, "before_cursor_execute", listener)
    try:
        call()
    finally:
        event.remove(eng, "before_cursor_execute", listener)
    return log


def fill(client, n):
    db = db_of(client)
    db.add_all([ReminderRow(id=f"r{n}-{i}", title="t", trigger_type="time", source_text="w") for i in range(n)])
    db.commit()


def test_privacy_counts_are_aggregates_not_full_scans(client):
    fill(client, 5)
    small = statements(client, lambda: client.get("/privacy"))
    fill(client, 300)
    big = statements(client, lambda: client.get("/privacy"))
    assert len(small) == len(big) <= 8
    assert all("count(" in s.lower() for s in big if "FROM reminders" in s)


def test_deleting_history_is_a_fixed_number_of_statements(client):
    fill(client, 5)
    n_small = len(statements(client, lambda: client.delete("/history", params={"confirm": "delete-everything"})))
    fill(client, 300)
    n_big = len(statements(client, lambda: client.delete("/history", params={"confirm": "delete-everything"})))
    assert n_small == n_big


def test_the_purge_is_bulk_too(client, monkeypatch):
    monkeypatch.setattr(config, "TRANSCRIPT_RETENTION_DAYS", 30)
    db = db_of(client)
    db.add_all([ReminderRow(id=f"o{i}", title="t", trigger_type="time", source_text="w",
                            created_at=utcnow() - timedelta(days=40)) for i in range(200)])
    db.commit()
    log = statements(client, lambda: retention.purge_expired(db))
    assert len(log) <= 6 and retention.purge_expired(db)["transcripts_erased"] == 0
