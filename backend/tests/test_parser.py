import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app import config, llm, parser
from tests.parser_cases import CASES, NOW_LOCAL, TZ
from tests.parser_cases_heldout import HELDOUT

NOW = datetime.fromisoformat(NOW_LOCAL).replace(tzinfo=ZoneInfo(TZ))
NY = ZoneInfo(TZ)


def run(monkeypatch, reply):
    """Run parse() with the model replaced by a canned reply (or error)."""
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")

    def fake(messages, model=None):
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(llm, "chat_json", fake)
    return parser.parse("anything", NOW, "s1", TZ)


def test_valid_reply_becomes_reminders(monkeypatch):
    out = run(monkeypatch, {"reminders": [{
        "title": "Call Mom", "description": None, "deadline": "2026-10-01T14:30:00-04:00",
        "triggerType": "time", "location": None}]})
    assert len(out) == 1
    assert out[0].title == "Call Mom" and out[0].session_id == "s1"
    assert out[0].deadline == datetime(2026, 10, 1, 18, 30, tzinfo=timezone.utc)


def test_deadline_without_offset_is_read_in_the_persons_timezone(monkeypatch):
    out = run(monkeypatch, {"reminders": [{
        "title": "x", "deadline": "2026-10-02T09:00:00", "triggerType": "time"}]})
    assert out[0].deadline == datetime(2026, 10, 2, 13, 0, tzinfo=timezone.utc)  # 9am EDT


def test_empty_list_is_a_valid_result(monkeypatch):
    assert run(monkeypatch, {"reminders": []}) == []


def test_trigger_type_is_fixed_to_match_the_data(monkeypatch):
    out = run(monkeypatch, {"reminders": [{
        "title": "Buy eggs", "deadline": None, "triggerType": "time",
        "location": {"type": "category", "category": "grocery_store", "name": None}}]})
    assert out[0].trigger_type == "location"
    assert out[0].location.name is None


def test_one_bad_item_does_not_lose_the_others(monkeypatch):
    out = run(monkeypatch, {"reminders": [
        {"title": "", "triggerType": "time"},           # invalid: empty title
        {"title": "Good one", "triggerType": "time"}]})
    assert [r.title for r in out] == ["Good one"]


def test_garbage_shape_falls_back_and_keeps_the_text(monkeypatch):
    out = run(monkeypatch, {"something": "else"})
    assert len(out) == 1 and out[0].title == "anything" and out[0].deadline is None


def test_llm_error_falls_back_and_keeps_the_text(monkeypatch):
    out = run(monkeypatch, llm.LLMError("boom"))
    assert len(out) == 1 and out[0].source_text == "anything" and out[0].deadline is None


def test_extract_json_handles_thinking_text_and_fences():
    raw = '<think>hmm {not json}</think>\n```json\n{"reminders": []}\n```'
    assert llm.extract_json(raw) == {"reminders": []}
    with pytest.raises(llm.LLMError):
        llm.extract_json("no json here")


def test_prompt_carries_local_time_and_weekday():
    system = parser.build_messages("hi", NOW, NY)[0]["content"]
    assert "2026-10-01 14:00" in system and "Thursday" in system and "America/New_York" in system
    # the precomputed calendar the model reads weekdays from
    assert "Thu 2026-10-01 (today)" in system and "Fri 2026-10-02 (tomorrow)" in system
    assert "Mon 2026-10-05" in system and "Thu 2026-10-15" in system


def test_unknown_timezone_does_not_crash():
    assert str(parser.resolve_tz("Mars/Olympus")) == config.DEFAULT_TIMEZONE


# ---- live: the real 30-phrase check against Nebius (build step 9) ----------

def check(expect, reminders):
    """Return None if the parse satisfies `expect`, else a reason string."""
    if "n" in expect and len(reminders) != expect["n"]:
        return f"expected {expect['n']} reminders, got {len(reminders)}"
    if expect.get("n") == 0:
        return None
    if not reminders:
        return "no reminders returned"
    r = reminders[0]
    if "trigger" in expect and r.trigger_type != expect["trigger"]:
        return f"trigger {r.trigger_type} != {expect['trigger']}"
    if expect.get("no_deadline") and r.deadline is not None:
        return f"expected no deadline, got {r.deadline}"
    if "date_in" in expect and (r.deadline is None or f"{r.deadline.astimezone(NY):%Y-%m-%d}" not in expect["date_in"]):
        return f"date {r.deadline and r.deadline.astimezone(NY):%Y-%m-%d} not in {expect['date_in']}"
    if "date" in expect or "hour" in expect:
        if r.deadline is None:
            return "expected a deadline"
        local = r.deadline.astimezone(NY)
        if "date" in expect and local.strftime("%Y-%m-%d") != expect["date"]:
            return f"date {local:%Y-%m-%d} != {expect['date']}"
        if "hour" in expect and local.hour != expect["hour"]:
            return f"hour {local.hour} != {expect['hour']}"
    loc = r.location
    if any(k.startswith("loc_") for k in expect):
        if loc is None:
            return "expected a location"
        if "loc_type" in expect and loc.type != expect["loc_type"]:
            return f"loc type {loc.type} != {expect['loc_type']}"
        if "loc_category" in expect and loc.category != expect["loc_category"]:
            return f"loc category {loc.category} != {expect['loc_category']}"
        if "loc_name" in expect and (loc.name or "").lower() != expect["loc_name"].lower():
            return f"loc name {loc.name} != {expect['loc_name']}"
    if "title_has" in expect and expect["title_has"] not in r.title.lower():
        return f"title {r.title!r} lacks {expect['title_has']!r}"
    return None


def test_checker_catches_a_wrong_parse():
    wrong = parser.parse_fallback("remind me to call Mom in 30 minutes", "s")
    assert check({"trigger": "time", "date": "2026-10-01", "hour": 14}, wrong) is not None
    assert check({"n": 0}, wrong) is not None


@pytest.mark.live
@pytest.mark.skipif(not os.getenv("NEBIUS_API_KEY"), reason="needs NEBIUS_API_KEY")
def test_thirty_phrases_live(monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    failures = []
    for text, expect in CASES:
        got = parser.parse_llm(text, NOW, NY, "live")
        reason = check(expect, got)
        if reason:
            failures.append(f"{text!r}: {reason}")
    passed = len(CASES) - len(failures)
    print(f"\nlive parser: {passed}/{len(CASES)} passed")
    for f in failures:
        print("  FAIL", f)
    assert passed >= 25, f"only {passed}/30 passed"


@pytest.mark.parametrize("bad", ["../../etc/passwd", "/etc/localtime", "Mars/Olympus", "UTC\x00"])
def test_hostile_timezone_never_raises(bad):
    assert str(parser.resolve_tz(bad)) == config.DEFAULT_TIMEZONE


def test_model_cannot_set_server_fields(monkeypatch):
    out = run(monkeypatch, {"reminders": [
        {"title": "A", "triggerType": "time", "id": "dup", "completed": True,
         "createdAt": "2000-01-01T00:00:00Z", "sessionId": "evil", "sourceText": "evil"},
        {"title": "B", "triggerType": "time", "id": "dup"}]})
    assert [r.id for r in out] == [None, None]
    assert out[0].completed is False and out[0].session_id == "s1" and out[0].source_text == "anything"
    assert out[0].created_at is None


def test_llm_failure_without_fallback_raises(monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("x")))
    with pytest.raises(llm.LLMError):
        parser.parse("chatter", NOW, "s1", TZ, fallback=False)
    assert len(parser.parse("typed", NOW, "s1", TZ, fallback=True)) == 1


@pytest.mark.parametrize("choices", [[], None])
def test_empty_choices_becomes_llm_error(monkeypatch, choices):
    from types import SimpleNamespace

    create = lambda **k: SimpleNamespace(choices=choices)  # noqa: E731
    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(llm, "get_client", lambda: fake)
    with pytest.raises(llm.LLMError):
        llm.chat_json([{"role": "user", "content": "x"}])


def test_session_route_saves_nothing_and_503s_when_the_model_fails(client, monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(llm.LLMError("x")))
    r = client.post("/sessions/parse", json={"text": "just chatting about lunch"})
    assert r.status_code == 503
    assert client.get("/reminders").json() == []
    # typed input still keeps what the person typed
    typed = client.post("/parse", json={"text": "call the bank"})
    assert typed.status_code == 200 and typed.json()["title"] == "call the bank"


def test_duplicate_ids_from_the_model_do_not_break_a_session(client, monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: {"reminders": [
        {"title": "A", "triggerType": "time", "id": "dup"},
        {"title": "B", "triggerType": "time", "id": "dup"}]})
    r = client.post("/sessions/parse", json={"text": "a and b"})
    assert r.status_code == 200 and len(r.json()["reminders"]) == 2


SAVED = {"reminders": [{"title": "Feed cat", "triggerType": "location",
                        "location": {"type": "saved_place", "name": "home"}}]}


def test_saved_place_is_sent_to_the_phone_as_a_named_place_for_now(client, monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: SAVED)
    flat = client.post("/parse", json={"text": "x"}).json()
    assert flat["location"] == {"type": "place", "name": "home"}  # fits the phone's current union
    stored = client.post("/sessions/parse", json={"text": "x"}).json()["reminders"][0]
    assert stored["location"]["type"] == "saved_place"  # the backend keeps the real meaning


def run_live(cases):
    failures = []
    for text, expect in cases:
        got = parser.parse_llm(text, NOW, NY, "live")
        reason = check(expect, got)
        if reason:
            failures.append(f"{text!r}: {reason}")
    return len(cases) - len(failures), failures


@pytest.mark.live
@pytest.mark.skipif(not os.getenv("NEBIUS_API_KEY"), reason="needs NEBIUS_API_KEY")
def test_heldout_phrases_live(monkeypatch):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    passed, failures = run_live(HELDOUT)
    print(f"\nheld-out parser: {passed}/{len(HELDOUT)} passed")
    for f in failures:
        print("  FAIL", f)
    assert passed >= 10, f"only {passed}/{len(HELDOUT)} passed"
