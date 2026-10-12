"""A malformed reminder is kept for review, and one bad chunk can't block the queue."""

from datetime import datetime, timezone

import pytest
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from app import chunks, config, llm, parser
from app.db import init_db, make_engine
from app.models import PendingChunkRow, ReminderRow

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
UTC = ZoneInfo("UTC")


def model_says(monkeypatch, reminders):
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: {"reminders": reminders})


# ---- a reminder the model got wrong is salvaged, not dropped ---------------

def test_a_bad_deadline_keeps_the_reminder_without_a_deadline(monkeypatch):
    model_says(monkeypatch, [
        {"title": "Call Mom", "triggerType": "time", "deadline": None},
        {"title": "Buy milk", "triggerType": "time", "deadline": "not a date"},
    ])
    out = parser.parse_llm("call mom and buy milk", NOW, UTC, "s")
    assert [(r.title, r.deadline) for r in out] == [("Call Mom", None), ("Buy milk", None)]


def test_a_bad_deadline_keeps_the_place_too(monkeypatch):
    model_says(monkeypatch, [{
        "title": "Get milk", "triggerType": "time_and_location", "deadline": "soonish",
        "location": {"type": "category", "category": "grocery_store"},
    }])
    (r,) = parser.parse_llm("get milk at the grocery store soonish", NOW, UTC, "s")
    assert r.deadline is None and r.trigger_type == "location" and r.location.category == "grocery_store"


def test_an_invalid_field_other_than_the_deadline_keeps_the_title_only(monkeypatch):
    model_says(monkeypatch, [{"title": "Call Mom", "triggerType": "time", "deadline": "soonish",
                              "location": {"type": "not-a-real-type"}}])
    (r,) = parser.parse_llm("call mom", NOW, UTC, "s")
    assert r.title == "Call Mom" and r.deadline is None and r.location is None


def test_an_item_with_no_usable_title_is_dropped_not_guessed_at(monkeypatch):
    model_says(monkeypatch, ["garbage", {"triggerType": "time"}, {"title": "", "triggerType": "time"}])
    assert parser.parse_llm("pick up the dry cleaning", NOW, UTC, "s") == []


def test_good_items_are_untouched_by_salvage(monkeypatch):
    model_says(monkeypatch, [{"title": "Call Mom", "triggerType": "time", "deadline": "2026-10-03T09:00:00+00:00"}])
    (r,) = parser.parse_llm("call mom tomorrow", NOW, UTC, "s")
    assert r.deadline == datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc)


# ---- a chunk the model keeps failing on does not block the others ----------

def db_with_chunks(texts):
    engine = make_engine("sqlite://")
    init_db(engine)
    db = Session(engine)
    for i, text in enumerate(texts):
        db.add(PendingChunkRow(session_id="s", text=text, captured_at=NOW.replace(microsecond=i)))
    db.commit()
    return db


def fake_parse(poison=(), reminders=()):
    def parse(text, now, session_id, tz_name=None, fallback=True, times=None, **kw):
        if text in poison:
            raise llm.ReplyError("content filtered")
        return list(reminders)
    return parse


def test_a_failing_chunk_does_not_block_the_ones_behind_it(monkeypatch):
    db = db_with_chunks(["poison", "good one", "good two"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"poison"}))
    left = chunks.retry_pending(db, "s")
    assert left == 1
    assert [c.text for c in db.exec(select(PendingChunkRow))] == ["poison"]


def test_the_failing_chunk_is_released_so_a_later_pass_can_retry_it(monkeypatch):
    db = db_with_chunks(["poison", "good"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"poison"}))
    chunks.retry_pending(db, "s")
    assert db.exec(select(PendingChunkRow)).one().claimed_at is None


def test_two_failures_in_a_row_stop_the_pass(monkeypatch):
    db = db_with_chunks(["a", "b", "c"])
    calls = []

    def always_down(text, *a, **k):
        calls.append(text)
        raise llm.LLMError("down")

    monkeypatch.setattr(parser, "parse", always_down)
    assert chunks.retry_pending(db, "s") == 3
    assert calls == ["a", "b"]  # stopped, did not hammer a model that is down


def test_a_spent_budget_stops_the_pass_at_once(monkeypatch):
    db = db_with_chunks(["a", "b", "c"])
    calls = []

    def over_budget(text, *a, **k):
        calls.append(text)
        raise llm.BudgetError("daily model call limit reached")

    monkeypatch.setattr(parser, "parse", over_budget)
    assert chunks.retry_pending(db, "s") == 3
    assert calls == ["a"]


def test_a_success_between_failures_resets_the_count(monkeypatch):
    db = db_with_chunks(["bad1", "good", "bad2", "good2"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"bad1", "bad2"}))
    assert chunks.retry_pending(db, "s") == 2
    assert sorted(c.text for c in db.exec(select(PendingChunkRow))) == ["bad1", "bad2"]
    assert db.exec(select(ReminderRow)).all() == []  # the stub found no reminders; chunks still cleared


# ---- a chunk the model can't handle is retried a few times, then kept for review

def test_two_unusable_chunks_at_the_front_do_not_block_the_queue(monkeypatch):
    db = db_with_chunks(["poison1", "poison2", "good"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"poison1", "poison2"}))
    assert chunks.retry_pending(db, "s") == 2
    assert sorted(c.text for c in db.exec(select(PendingChunkRow))) == ["poison1", "poison2"]


def test_a_chunk_that_keeps_failing_becomes_a_reminder_to_review(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 3)
    db = db_with_chunks(["pick up the parcel from UPS"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"pick up the parcel from UPS"}))
    assert chunks.retry_pending(db, "s") == 1
    assert chunks.retry_pending(db, "s") == 1
    assert db.exec(select(PendingChunkRow)).one().attempts == 2
    assert chunks.retry_pending(db, "s") == 0          # third failure: stop retrying
    (r,) = db.exec(select(ReminderRow)).all()          # but the words are not lost
    assert (r.title, r.deadline, r.session_id) == (parser.UNREADABLE_TITLE, None, "s")
    assert r.source_text == "pick up the parcel from UPS"


def test_overheard_words_never_become_the_title_of_a_review_reminder(monkeypatch):
    # The title outlives the transcript: erasure and retention only clear source_text.
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 1)
    db = db_with_chunks(["my sister's PIN is 4821"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"my sister's PIN is 4821"}))
    chunks.retry_pending(db, "s")
    (r,) = db.exec(select(ReminderRow)).all()
    assert "4821" not in r.title


def test_two_different_unreadable_chunks_are_two_review_reminders(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 1)
    db = db_with_chunks(["call the bank", "renew the passport"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"call the bank", "renew the passport"}))
    assert chunks.retry_pending(db, "s") == 0
    assert sorted(r.source_text for r in db.exec(select(ReminderRow))) == ["call the bank", "renew the passport"]


def test_an_outage_never_uses_up_a_chunks_attempts(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 3)
    db = db_with_chunks(["a", "b"])

    def down(text, *a, **k):
        raise llm.LLMError("Nebius request failed: APIConnectionError")

    monkeypatch.setattr(parser, "parse", down)
    for _ in range(10):
        assert chunks.retry_pending(db, "s") == 2
    assert [c.attempts for c in db.exec(select(PendingChunkRow))] == [0, 0]
    assert db.exec(select(ReminderRow)).all() == []


def test_the_review_reminder_is_not_saved_twice(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 1)
    db = db_with_chunks(["call the bank", "call the bank"])
    monkeypatch.setattr(parser, "parse", fake_parse(poison={"call the bank"}))
    assert chunks.retry_pending(db, "s") == 0
    assert len(db.exec(select(ReminderRow)).all()) == 1


# ---- a refused request only counts once the config is shown to work ---------

def refuse(poison):
    def parse(text, now, session_id, tz_name=None, fallback=True, times=None, **kw):
        if text in poison:
            raise llm.RequestRefused("Nebius refused the request: BadRequestError")
        return []
    return parse


def test_a_config_that_refuses_every_request_never_uses_up_attempts(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_ATTEMPTS", 3)
    db = db_with_chunks(["a", "b", "c"])
    calls = []

    def refuse_all(text, *a, **k):
        calls.append(text)
        raise llm.RequestRefused("Nebius refused the request: BadRequestError")

    monkeypatch.setattr(parser, "parse", refuse_all)
    for _ in range(5):
        assert chunks.retry_pending(db, "s") == 3
    assert calls == ["a", "b"] * 5  # stops after two, like an outage
    assert [c.attempts for c in db.exec(select(PendingChunkRow))] == [0, 0, 0]
    assert db.exec(select(ReminderRow)).all() == []  # and no junk review reminders


def test_a_refused_chunk_counts_when_another_chunk_got_through(monkeypatch):
    db = db_with_chunks(["poison", "fine"])
    monkeypatch.setattr(parser, "parse", refuse(poison={"poison"}))
    assert chunks.retry_pending(db, "s") == 1
    assert db.exec(select(PendingChunkRow)).one().attempts == 1


def test_a_refused_chunk_alone_in_the_queue_is_not_counted(monkeypatch):
    db = db_with_chunks(["poison"])
    monkeypatch.setattr(parser, "parse", refuse(poison={"poison"}))
    assert chunks.retry_pending(db, "s") == 1
    assert db.exec(select(PendingChunkRow)).one().attempts == 0


# ---- which failures count against a chunk -----------------------------------

class FakeResponse:
    def __init__(self, choices):
        self.choices, self.usage = choices, None


class FakeClient:
    def __init__(self, result):
        self.chat = self
        self.completions = self
        self.result = result

    def create(self, **kwargs):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def call_with(monkeypatch, result):
    from app import usage
    monkeypatch.setattr(usage, "reserve_call", lambda: None)
    monkeypatch.setattr(llm, "get_client", lambda: FakeClient(result))
    return llm.chat_json([{"role": "user", "content": "x"}])


def test_a_refused_input_is_a_reply_error(monkeypatch):
    import httpx
    import openai
    req = httpx.Request("POST", "https://example.invalid")
    err = openai.BadRequestError("bad", response=httpx.Response(400, request=req), body=None)
    with pytest.raises(llm.RequestRefused):
        call_with(monkeypatch, err)


def test_a_wrong_model_name_is_an_outage_not_the_chunks_fault(monkeypatch):
    # Nebius answers an unknown model with 404 (checked live 2026-10-12).
    import httpx
    import openai
    req = httpx.Request("POST", "https://example.invalid")
    err = openai.NotFoundError("no such model", response=httpx.Response(404, request=req), body=None)
    with pytest.raises(llm.LLMError) as e:
        call_with(monkeypatch, err)
    assert not isinstance(e.value, llm.ReplyError)


def test_a_connection_failure_is_not_a_reply_error(monkeypatch):
    with pytest.raises(llm.LLMError) as e:
        call_with(monkeypatch, ConnectionError("no route"))
    assert not isinstance(e.value, llm.ReplyError)


def test_an_empty_or_garbled_reply_is_a_reply_error(monkeypatch):
    with pytest.raises(llm.ReplyError):
        call_with(monkeypatch, FakeResponse([]))
    with pytest.raises(llm.ReplyError):
        llm.extract_json("no json here")


def test_a_reply_without_a_reminders_list_is_a_reply_error(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", lambda m, model=None: {"something": "else"})
    with pytest.raises(llm.ReplyError):
        parser.parse_llm("hello", NOW, UTC, "s")
