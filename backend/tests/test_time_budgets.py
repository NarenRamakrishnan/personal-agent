"""Round 2 of the 2026-10-12 review: a slow model can't hold a request, the per-minute
limit holds across server processes, and turning transcripts off doesn't lose chunks."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from app import chunks, config, llm, parser, sessions, usage
from app.db import make_engine
from app.models import PendingChunkRow, ReminderRow, utcnow

from tests.test_privacy import Model, chunk, db_of
from tests.test_salvage_and_retry import db_with_chunks


# ---- a backlog retry stops when its time is up --------------------------------

class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def slow_parse(clock, seconds, seen):
    def parse(text, now, session_id, tz_name=None, fallback=True, times=None):
        seen.append((text, llm._time_limit.get()))
        clock.t += seconds
        return []
    return parse


def test_a_pass_stops_starting_calls_when_its_time_is_up(monkeypatch):
    clock, seen = FakeClock(), []
    monkeypatch.setattr(chunks.time, "monotonic", clock)
    monkeypatch.setattr(parser, "parse", slow_parse(clock, 6, seen))
    db = db_with_chunks(["a", "b", "c"])
    assert chunks.retry_pending(db, "s", budget_s=8) == 2   # b and c wait for the next pass
    assert [t for t, _ in seen] == ["a"]


def test_each_call_only_gets_the_time_that_is_left(monkeypatch):
    clock, seen = FakeClock(), []
    monkeypatch.setattr(chunks.time, "monotonic", clock)
    monkeypatch.setattr(parser, "parse", slow_parse(clock, 5, seen))
    db = db_with_chunks(["a", "b", "c"])
    chunks.retry_pending(db, "s", budget_s=20)
    assert [limit for _, limit in seen] == [20, 15, 10]


def test_without_a_budget_nothing_changes(monkeypatch):
    seen = []
    monkeypatch.setattr(parser, "parse", slow_parse(FakeClock(), 100, seen))
    db = db_with_chunks(["a", "b"])
    assert chunks.retry_pending(db, "s") == 0
    assert [limit for _, limit in seen] == [None, None]


class Recorder:
    def __init__(self):
        self.options = None
        self.chat = self.completions = self

    def with_options(self, **kw):
        self.options = kw
        return self

    def create(self, **kw):
        raise ConnectionError("stop here")


def test_a_time_limit_reaches_the_nebius_client(monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(usage, "reserve_call", lambda: None)
    monkeypatch.setattr(llm, "get_client", lambda: rec)
    with llm.time_limit(7), pytest.raises(llm.LLMError):
        llm.chat_json([{"role": "user", "content": "x"}])
    assert rec.options == {"timeout": 7, "max_retries": 0}
    rec.options = None
    with pytest.raises(llm.LLMError):
        llm.chat_json([{"role": "user", "content": "x"}])
    assert rec.options is None  # no limit outside the block


def capture_budgets(monkeypatch):
    budgets = []
    real = chunks.retry_pending

    def spy(db, session_id, limit=None, budget_s=None):
        budgets.append(budget_s)
        return real(db, session_id, limit=limit, budget_s=budget_s)

    monkeypatch.setattr(chunks, "retry_pending", spy)
    return budgets


def test_ending_and_retrying_a_session_use_the_long_budget(client, monkeypatch):
    budgets = capture_budgets(monkeypatch)
    sid = client.post("/sessions").json()["id"]
    client.post(f"/sessions/{sid}/retry")
    client.post(f"/sessions/{sid}/end")
    assert budgets == [config.PENDING_RETRY_BUDGET_S] * 2


def test_the_catch_up_after_a_good_chunk_uses_the_short_budget(client, monkeypatch):
    m = Model()
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", m)
    sid = client.post("/sessions").json()["id"]
    m.up = False
    chunk(client, sid, "call mom")
    m.up = True
    budgets = capture_budgets(monkeypatch)
    chunk(client, sid, "buy eggs")
    assert budgets == [config.PENDING_INLINE_BUDGET_S]


# ---- the per-minute limit is shared, not per process -------------------------

@pytest.fixture()
def eng():
    return make_engine("sqlite://")


def at(monkeypatch, when):
    monkeypatch.setattr(usage, "_now", lambda: when)


def test_the_per_minute_count_lives_in_the_database(monkeypatch, eng):
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", 0)
    monkeypatch.setattr(config, "LLM_DAILY_TOKEN_LIMIT", 0)
    monkeypatch.setattr(config, "LLM_CALLS_PER_MINUTE", 2)
    at(monkeypatch, datetime(2026, 10, 12, 9, 30, 5, tzinfo=timezone.utc))
    usage.reserve_call(eng)
    usage.reserve_call(eng)
    # Nothing is kept in this process: a fresh one sees the same full minute.
    assert not hasattr(usage, "_recent")
    with pytest.raises(usage.BudgetExceeded, match="minute"):
        usage.reserve_call(eng)
    at(monkeypatch, datetime(2026, 10, 12, 9, 31, 0, tzinfo=timezone.utc))
    usage.reserve_call(eng)  # a new minute
    assert usage.snapshot(eng)["calls"] == 3


def test_the_daily_limit_still_wins_over_a_free_minute(monkeypatch, eng):
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", 1)
    monkeypatch.setattr(config, "LLM_DAILY_TOKEN_LIMIT", 0)
    monkeypatch.setattr(config, "LLM_CALLS_PER_MINUTE", 10)
    at(monkeypatch, datetime(2026, 10, 12, 9, 30, tzinfo=timezone.utc))
    usage.reserve_call(eng)
    with pytest.raises(usage.BudgetExceeded, match="daily model call limit"):
        usage.reserve_call(eng)


def test_init_db_adds_the_minute_columns_to_an_existing_usage_table():
    from sqlalchemy import inspect, text
    from app.db import init_db
    eng = make_engine("sqlite://")
    with eng.begin() as conn:  # the table as it was before the shared throttle
        conn.execute(text("CREATE TABLE llm_usage (day VARCHAR PRIMARY KEY, calls INTEGER NOT NULL, tokens INTEGER NOT NULL)"))
        conn.execute(text("INSERT INTO llm_usage VALUES ('2026-10-12', 5, 100)"))
    init_db(eng)
    cols = {c["name"] for c in inspect(eng).get_columns("llm_usage")}
    assert {"minute", "minute_calls"} <= cols
    with eng.connect() as conn:
        assert conn.execute(text("SELECT minute_calls FROM llm_usage")).scalar() == 0


# ---- turning transcripts off parses what's queued first ----------------------

def queue_one(client, monkeypatch, text="call mom"):
    m = Model()
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", m)
    sid = client.post("/sessions").json()["id"]
    m.up = False
    assert chunk(client, sid, text).status_code == 202
    return m, sid


def test_queued_chunks_are_parsed_before_transcripts_are_erased(client, monkeypatch):
    m, sid = queue_one(client, monkeypatch)
    m.up = True
    r = client.patch("/settings", json={"keepTranscripts": False}).json()
    assert r["unparsedChunksDeleted"] == 0
    db = db_of(client)
    (rem,) = db.exec(select(ReminderRow)).all()
    assert rem.title == "CALL MOM" and rem.source_text is None   # kept the commitment, not the words
    assert db.exec(select(PendingChunkRow)).all() == []


def test_chunks_the_model_still_cant_parse_are_counted_then_erased(client, monkeypatch):
    queue_one(client, monkeypatch)  # the model stays down
    r = client.patch("/settings", json={"keepTranscripts": False}).json()
    assert r["unparsedChunksDeleted"] == 1 and r["keepTranscripts"] is False
    assert db_of(client).exec(select(PendingChunkRow)).all() == []


def test_the_count_only_appears_when_the_switch_turns_off(client):
    assert "unparsedChunksDeleted" not in client.patch("/settings", json={"notifyLevel": "normal"}).json()


# ---- a normal pause doesn't end a session ------------------------------------

def test_a_three_minute_pause_keeps_the_session_by_default(client, monkeypatch):
    t = utcnow()
    now = {"t": t}
    monkeypatch.setattr(sessions, "_now", lambda: now["t"])
    assert config.SESSION_SILENCE_TIMEOUT_S >= 600
    sid = client.post("/sessions").json()["id"]
    now["t"] = t + timedelta(minutes=3)
    assert chunk(client, sid, "buy milk").status_code == 200
    now["t"] = t + timedelta(minutes=3 + 11)
    assert client.get(f"/sessions/{sid}").json()["status"] == "ended"
