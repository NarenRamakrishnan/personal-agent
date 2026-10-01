from types import SimpleNamespace

import pytest

from app import config, llm, usage
from app.db import make_engine


@pytest.fixture()
def eng():
    return make_engine("sqlite://")


def limits(monkeypatch, calls=0, tokens=0, per_minute=0):
    monkeypatch.setattr(config, "LLM_DAILY_CALL_LIMIT", calls)
    monkeypatch.setattr(config, "LLM_DAILY_TOKEN_LIMIT", tokens)
    monkeypatch.setattr(config, "LLM_CALLS_PER_MINUTE", per_minute)


def test_daily_call_limit_refuses_the_next_call(monkeypatch, eng):
    limits(monkeypatch, calls=3)
    for _ in range(3):
        usage.reserve_call(eng)
    with pytest.raises(usage.BudgetExceeded, match="call limit"):
        usage.reserve_call(eng)
    assert usage.snapshot(eng)["calls"] == 3  # the refused call was not counted


def test_daily_token_limit_refuses_once_spent(monkeypatch, eng):
    limits(monkeypatch, tokens=1000)
    usage.reserve_call(eng)
    usage.record_tokens(1000, eng)
    with pytest.raises(usage.BudgetExceeded, match="token limit"):
        usage.reserve_call(eng)


def test_per_minute_throttle(monkeypatch, eng):
    limits(monkeypatch, per_minute=2)
    usage.reserve_call(eng)
    usage.reserve_call(eng)
    with pytest.raises(usage.BudgetExceeded, match="minute"):
        usage.reserve_call(eng)


def test_zero_disables_each_check(monkeypatch, eng):
    limits(monkeypatch)
    for _ in range(50):
        usage.reserve_call(eng)
    usage.record_tokens(10**9, eng)
    usage.reserve_call(eng)


def fake_client(tokens=123, boom=False):
    def create(**kwargs):
        if boom:
            raise AssertionError("Nebius must not be called once over budget")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"reminders": []}'))],
            usage=None if tokens is None else SimpleNamespace(total_tokens=tokens),
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def test_over_budget_never_reaches_nebius(monkeypatch):
    limits(monkeypatch, calls=1)
    monkeypatch.setattr(llm, "get_client", lambda: fake_client())
    llm.chat_json([{"role": "user", "content": "x"}])
    monkeypatch.setattr(llm, "get_client", lambda: fake_client(boom=True))
    with pytest.raises(llm.BudgetError):
        llm.chat_json([{"role": "user", "content": "x"}])


def test_tokens_are_recorded_from_the_response(monkeypatch):
    limits(monkeypatch)
    monkeypatch.setattr(llm, "get_client", lambda: fake_client(tokens=250))
    llm.chat_json([{"role": "user", "content": "x"}])
    snap = usage.snapshot()
    assert snap["calls"] == 1 and snap["tokens"] == 250


def test_a_missing_usage_block_does_not_lose_the_reply(monkeypatch):
    limits(monkeypatch)
    monkeypatch.setattr(llm, "get_client", lambda: fake_client(tokens=None))
    assert llm.chat_json([{"role": "user", "content": "x"}]) == {"reminders": []}


def test_sessions_parse_503s_and_typed_parse_falls_back_when_over_budget(client, monkeypatch):
    limits(monkeypatch, calls=1)
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    monkeypatch.setattr(llm, "get_client", lambda: fake_client())
    usage.reserve_call()  # today's budget is already spent
    monkeypatch.setattr(llm, "get_client", lambda: fake_client(boom=True))
    assert client.post("/sessions/parse", json={"text": "chatter"}).status_code == 503
    assert client.get("/reminders").json() == []
    typed = client.post("/parse", json={"text": "call the bank"})
    assert typed.status_code == 200 and typed.json()["title"] == "call the bank"


def test_usage_endpoint_reports_today(client, monkeypatch):
    limits(monkeypatch, calls=10, tokens=5000, per_minute=60)
    usage.reserve_call()
    usage.record_tokens(42)
    body = client.get("/usage").json()
    assert body["calls"] == 1 and body["tokens"] == 42
    assert body["callLimit"] == 10 and body["tokenLimit"] == 5000
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/usage").status_code == 401
