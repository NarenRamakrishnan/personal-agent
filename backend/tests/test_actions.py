import re
from pathlib import Path

import pytest

from app import config, emailer, llm

LATE = "email Alex saying I'll be 10 minutes late"


def model(monkeypatch, reply):
    monkeypatch.setattr(config, "PARSER_MODE", "nebius")
    if isinstance(reply, Exception):
        def boom(*a, **k):
            raise reply
        monkeypatch.setattr(llm, "chat_json", boom)
    else:
        monkeypatch.setattr(llm, "chat_json", lambda *a, **k: reply)


GOOD = {"email": {"toName": "Alex", "to": None, "subject": "Running late",
                  "body": "Hi Alex, I'll be about 10 minutes late."}}


def draft(client, monkeypatch, reply=GOOD, text=LATE, **extra):
    model(monkeypatch, reply)
    return client.post("/actions/email", json={"text": text, **extra})


# ---- creating a draft ----------------------------------------------------

def test_draft_always_starts_needing_approval(client, monkeypatch):
    r = draft(client, monkeypatch)
    assert r.status_code == 201
    a = r.json()
    assert a["status"] == "needs_approval" and "approvedAt" not in a
    assert a["email"]["toName"] == "Alex" and a["email"]["subject"] == "Running late"
    assert "to" not in a["email"]  # no address was spoken, so none is invented


def test_not_an_email_request_is_422_and_saves_nothing(client, monkeypatch):
    assert draft(client, monkeypatch, {"email": None}, text="nice weather").status_code == 422
    assert client.get("/actions").json() == []


@pytest.mark.parametrize("reply", [
    {}, {"email": "text"}, {"email": {"subject": "x"}}, {"email": {"body": "x"}},
    {"email": {"subject": "  ", "body": "x"}},
])
def test_incomplete_model_reply_is_422(client, monkeypatch, reply):
    assert draft(client, monkeypatch, reply).status_code == 422


def test_model_failure_or_budget_is_503_and_saves_nothing(client, monkeypatch):
    assert draft(client, monkeypatch, llm.LLMError("x")).status_code == 503
    assert draft(client, monkeypatch, llm.BudgetError("over")).status_code == 503
    assert client.get("/actions").json() == []


@pytest.mark.parametrize("path_text", ["   ", "x" * 5001])
def test_bad_text_is_422(client, path_text):
    assert client.post("/actions/email", json={"text": path_text}).status_code == 422


def test_mock_mode_still_produces_a_draft(client):
    r = client.post("/actions/email", json={"text": LATE})
    assert r.status_code == 201 and r.json()["status"] == "needs_approval"


# ---- the recipient must come from the speaker ----------------------------

def test_an_address_the_person_never_said_is_dropped(client, monkeypatch):
    bad = {"email": {**GOOD["email"], "to": "alex@attacker.example"}}
    assert "to" not in draft(client, monkeypatch, bad).json()["email"]


def test_a_spoken_address_is_kept_in_any_case(client, monkeypatch):
    reply = {"email": {**GOOD["email"], "to": "Alex.Kim@UMass.edu"}}
    text = "email alex.kim@umass.edu that I'm late"
    assert draft(client, monkeypatch, reply, text=text).json()["email"]["to"] == "Alex.Kim@UMass.edu"


@pytest.mark.parametrize("junk", ["alex", "alex@", "@umass.edu", "a b@c.com", 42, ["a@b.co"]])
def test_malformed_address_is_dropped_even_if_spoken(client, monkeypatch, junk):
    reply = {"email": {**GOOD["email"], "to": junk}}
    text = f"email {junk} that I'm late"
    assert "to" not in draft(client, monkeypatch, reply, text=text).json()["email"]


def test_the_prompt_forbids_guessing_an_address():
    system = emailer.build_messages("x", __import__("datetime").datetime.now().astimezone(), emailer.ZoneInfo("UTC"))[0]["content"]
    assert "Never guess" in system and "Do not add details" in system


# ---- approval is explicit and fragile ------------------------------------

def make(client, monkeypatch, **extra):
    return draft(client, monkeypatch, **extra).json()["id"]


def test_approve_then_approve_again_keeps_the_first_time(client, monkeypatch):
    aid = make(client, monkeypatch)
    first = client.post(f"/actions/{aid}/approve").json()
    again = client.post(f"/actions/{aid}/approve").json()
    assert first["status"] == "approved" and first["approvedAt"] == again["approvedAt"]


def test_editing_withdraws_the_approval(client, monkeypatch):
    aid = make(client, monkeypatch)
    client.post(f"/actions/{aid}/approve")
    edited = client.patch(f"/actions/{aid}", json={"body": "Different text entirely."}).json()
    assert edited["status"] == "needs_approval" and "approvedAt" not in edited
    assert edited["email"]["body"] == "Different text entirely."


def test_cancelled_drafts_cannot_be_approved_or_edited(client, monkeypatch):
    aid = make(client, monkeypatch)
    assert client.post(f"/actions/{aid}/cancel").json()["status"] == "cancelled"
    assert client.post(f"/actions/{aid}/approve").status_code == 409
    assert client.patch(f"/actions/{aid}", json={"subject": "x"}).status_code == 409


def test_an_approved_draft_can_still_be_cancelled(client, monkeypatch):
    aid = make(client, monkeypatch)
    client.post(f"/actions/{aid}/approve")
    cancelled = client.post(f"/actions/{aid}/cancel").json()
    assert cancelled["status"] == "cancelled" and "approvedAt" not in cancelled


def test_edit_validates_the_address_and_can_clear_it(client, monkeypatch):
    aid = make(client, monkeypatch)
    assert client.patch(f"/actions/{aid}", json={"to": "not-an-address"}).status_code == 422
    ok = client.patch(f"/actions/{aid}", json={"to": "alex@umass.edu"}).json()
    assert ok["email"]["to"] == "alex@umass.edu"
    cleared = client.patch(f"/actions/{aid}", json={"to": None}).json()
    assert "to" not in cleared["email"]


def test_edit_cannot_blank_the_subject_or_body(client, monkeypatch):
    aid = make(client, monkeypatch)
    assert client.patch(f"/actions/{aid}", json={"subject": ""}).status_code == 422
    assert client.patch(f"/actions/{aid}", json={"body": None}).json()["email"]["body"].startswith("Hi Alex")


def test_unknown_action_is_404(client):
    assert client.get("/actions/nope").status_code == 404
    assert client.post("/actions/nope/approve").status_code == 404
    assert client.post("/actions/nope/cancel").status_code == 404
    assert client.patch("/actions/nope", json={"subject": "x"}).status_code == 404


# ---- the review list -----------------------------------------------------

def test_session_review_list_includes_email_drafts_needing_approval(client, monkeypatch):
    sid = client.post("/sessions").json()["id"]
    make(client, monkeypatch, sessionId=sid)
    review = client.get(f"/sessions/{sid}").json()
    assert [a["status"] for a in review["actions"]] == ["needs_approval"]
    assert review["actions"][0]["email"]["toName"] == "Alex"
    assert client.get("/actions", params={"sessionId": sid}).json()[0]["id"] == review["actions"][0]["id"]


def test_actions_need_the_api_key_when_set(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/actions").status_code == 401
    assert client.post("/actions/email", json={"text": "x"}).status_code == 401


# ---- there is no way for the backend to send mail ------------------------

def test_backend_contains_no_mail_sending_code():
    banned = re.compile(r"smtplib|sendgrid|mailgun|ses\.send|gmail|sendmail|send_message|aiosmtplib|\bimport requests\b", re.I)
    offenders = [
        f"{p.name}: {m.group(0)}"
        for p in Path(__file__).resolve().parents[1].glob("app/**/*.py")
        for m in banned.finditer(p.read_text())
    ]
    assert offenders == []


# ---- real model quirks seen in live runs --------------------------------

def test_body_returned_as_a_list_of_lines_is_accepted(client, monkeypatch):
    reply = {"email": {**GOOD["email"], "body": ["I am writing to let you know the sink is leaking.", "Please fix it."]}}
    a = draft(client, monkeypatch, reply).json()
    assert a["email"]["body"] == "I am writing to let you know the sink is leaking.\nPlease fix it."


def test_line_breaks_in_the_body_are_kept_but_tidied(client, monkeypatch):
    reply = {"email": {**GOOD["email"], "body": "  Hello Professor Rivera,\r\n\r\n\r\n   I would like to ask   about Friday.  \n\n"}}
    assert draft(client, monkeypatch, reply).json()["email"]["body"] == "Hello Professor Rivera,\n\nI would like to ask about Friday."


@pytest.mark.parametrize("body", [[], [1, 2], "\n\n  \n", None, 5, {"a": 1}])
def test_unusable_bodies_are_422_not_500(client, monkeypatch, body):
    assert draft(client, monkeypatch, {"email": {**GOOD["email"], "body": body}}).status_code == 422


def test_model_that_refuses_is_a_422_and_saves_nothing(client, monkeypatch):
    # live behaviour: {"text": "I'm sorry, but I can't help with that."}
    assert draft(client, monkeypatch, {"text": "I'm sorry, but I can't help with that."}).status_code == 422
    assert client.get("/actions").json() == []
