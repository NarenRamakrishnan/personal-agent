"""Module 11: what Heedly remembers (people, usual places) and repeating reminders."""

from datetime import datetime, timedelta, timezone

from sqlmodel import select

from app import memory
from app.models import MemoryRow, ReminderRow

from tests.test_open_reminders import model, remember, say  # noqa: F401 - fixture
from tests.test_privacy import db_of

PRIYA = {"kind": "person", "name": "Mom", "alias": "Priya", "email": "priya@example.com"}


def memories(client):
    return client.get("/memories").json()


# ---- learning, and only what was said -------------------------------------------

def test_a_stated_fact_is_remembered_and_shown_in_the_session_review(client, model):
    model.reply = {"reminders": [], "memories": [PRIYA]}
    say(client, "My mom Priya, her email is priya@example.com", sid="s1")
    (m,) = memories(client)
    assert (m["kind"], m["label"], m["alias"], m["email"]) == ("person", "Mom", "Priya", "priya@example.com")
    detail = client.post("/sessions/s1/end").json()
    assert [x["label"] for x in detail["learned"]] == ["Mom"]


def test_an_email_the_person_never_said_is_not_kept(client, model):
    model.reply = {"reminders": [], "memories": [{**PRIYA, "email": "attacker@evil.example"}]}
    say(client, "My mom Priya, her email is priya@example.com")
    assert memories(client)[0].get("email") is None  # the alias was said, the address wasn't


def test_a_person_with_nothing_known_is_not_kept(client, model):
    model.reply = {"reminders": [], "memories": [{"kind": "person", "name": "Mom"}]}
    say(client, "I talked to my mom today")
    assert memories(client) == []


def test_a_name_that_was_not_said_is_not_kept(client, model):
    model.reply = {"reminders": [], "memories": [{"kind": "person", "name": "Boss", "email": "a@b.co"}]}
    say(client, "email is a@b.co")
    assert memories(client) == []


def test_a_usual_place_must_be_one_the_person_named(client, model):
    model.reply = {"reminders": [], "memories": [{"kind": "place", "for": "groceries", "place": "Whole Foods"}]}
    say(client, "I always get groceries at Trader Joe's")
    assert memories(client) == []
    model.reply = {"reminders": [], "memories": [{"kind": "place", "for": "groceries", "place": "Trader Joe's"}]}
    say(client, "I always get groceries at Trader Joe's")
    (m,) = memories(client)
    assert (m["label"], m["placeName"], m["placeType"]) == ("groceries", "Trader Joe's", "place")


def test_a_category_teaches_nothing_and_a_saved_place_stays_saved(client, model):
    model.reply = {"reminders": [], "memories": [{"kind": "place", "for": "milk", "place": "grocery store"},
                                                 {"kind": "place", "for": "laundry", "place": "home"}]}
    say(client, "I get milk at the grocery store and do laundry at home")
    (m,) = memories(client)
    assert (m["label"], m["placeName"], m["placeType"]) == ("laundry", "home", "saved_place")


def test_saying_it_again_updates_the_same_fact(client, model):
    model.reply = {"reminders": [], "memories": [{"kind": "place", "for": "groceries", "place": "Trader Joe's"}]}
    say(client, "I always get groceries at Trader Joe's")
    model.reply = {"reminders": [], "memories": [{"kind": "place", "for": "the groceries", "place": "Aldi"}]}
    say(client, "Actually I get the groceries at Aldi now")
    (m,) = memories(client)
    assert m["placeName"] == "Aldi"


def test_junk_from_the_model_is_ignored(client, model):
    model.reply = {"reminders": [], "memories": ["text", {"kind": "secret"}, None, {"kind": "place"}]}
    say(client, "hello there")
    assert memories(client) == []


# ---- using what it knows ----------------------------------------------------------

def test_known_facts_reach_the_prompt_without_email_addresses(client, model):
    model.reply = {"reminders": [], "memories": [PRIYA, {"kind": "place", "for": "groceries", "place": "Trader Joe's"}]}
    say(client, "My mom Priya, her email is priya@example.com. I always get groceries at Trader Joe's")
    say(client, "buy milk on the way home")
    prompt = model.prompts[-1]
    assert 'person "Mom" (also called "Priya"), email on file' in prompt
    assert '"groceries": they usually go to "Trader Joe\'s"' in prompt
    assert "priya@example.com" not in prompt


def test_email_to_a_remembered_person_gets_their_address(client, model, monkeypatch):
    model.reply = {"reminders": [], "memories": [PRIYA]}
    say(client, "My mom Priya, her email is priya@example.com")
    model.reply = {"email": {"toName": "my mom", "to": None, "subject": "Running late", "body": "I'm running late."}}
    draft = client.post("/actions/email", json={"text": "email my mom that I'm running late"}).json()
    assert draft["email"]["to"] == "priya@example.com"
    model.reply = {"email": {"toName": "Priya", "to": None, "subject": "Hi", "body": "Hi."}}
    assert client.post("/actions/email", json={"text": "email Priya hi"}).json()["email"]["to"] == "priya@example.com"
    model.reply = {"email": {"toName": "Alex", "to": None, "subject": "Hi", "body": "Hi."}}
    assert client.post("/actions/email", json={"text": "email Alex hi"}).json()["email"].get("to") is None


def test_each_device_has_its_own_memory(client, model):
    model.reply = {"reminders": [], "memories": [PRIYA]}
    say(client, "My mom Priya, her email is priya@example.com")
    other = client.post("/devices").json()["token"]
    assert client.get("/memories", headers={"Authorization": f"Bearer {other}"}).json() == []


# ---- the person stays in charge ---------------------------------------------------

def test_the_person_can_correct_forget_and_put_back(client, model):
    model.reply = {"reminders": [], "memories": [PRIYA]}
    say(client, "My mom Priya, her email is priya@example.com")
    (m,) = memories(client)
    assert client.patch(f"/memories/{m['id']}", json={"email": "not an email"}).status_code == 422
    assert client.patch(f"/memories/{m['id']}", json={"email": "p@new.example"}).json()["email"] == "p@new.example"
    assert client.delete(f"/memories/{m['id']}").status_code == 204
    assert memories(client) == []
    back = client.post("/memories", json={"kind": "person", "label": "Mom", "alias": "Priya", "email": "p@new.example"})
    assert back.status_code == 201 and memories(client)[0]["alias"] == "Priya"
    assert client.post("/memories", json={"kind": "place", "label": "milk"}).status_code == 422


def test_deleting_history_forgets_everything(client, model):
    model.reply = {"reminders": [], "memories": [PRIYA]}
    say(client, "My mom Priya, her email is priya@example.com")
    r = client.delete("/history?confirm=delete-everything").json()
    assert r["deleted"]["memories"] == 1 and memories(client) == []


def test_the_mock_parser_learns_its_two_shapes(client):
    client.post("/sessions/parse", json={"text": "my sister's email is ana@example.com", "sessionId": "m1"})
    client.post("/sessions/parse", json={"text": "I always get coffee at Blue Bottle", "sessionId": "m1"})
    labels = {(m["kind"], m["label"]) for m in memories(client)}
    assert labels == {("person", "sister"), ("place", "coffee")}
    assert client.get("/reminders").json() == []  # a fact is not a reminder


# ---- repeating reminders -----------------------------------------------------------

NOW = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)


def test_next_time_keeps_the_time_of_day_and_lands_after_now():
    monday_9 = datetime(2026, 10, 26, 13, 0, tzinfo=timezone.utc)
    assert memory.next_time(monday_9, "weekly", NOW) == datetime(2026, 11, 2, 13, 0, tzinfo=timezone.utc)
    assert memory.next_time(monday_9, "daily", NOW) == datetime(2026, 10, 29, 13, 0, tzinfo=timezone.utc)
    jan_31 = datetime(2026, 1, 31, 13, 0, tzinfo=timezone.utc)
    assert memory.next_time(jan_31, "monthly", datetime(2026, 2, 1, tzinfo=timezone.utc)) == datetime(2026, 2, 28, 13, 0, tzinfo=timezone.utc)


def test_finishing_a_repeating_reminder_makes_the_next_and_undo_takes_it_back(client):
    deadline = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    remember(client, "trash", "Take out the trash", deadline=deadline, repeat="weekly")
    client.patch("/reminders/trash", json={"completed": True})
    rows = {r["id"]: r for r in client.get("/reminders").json()}
    (nxt,) = [r for r in rows.values() if r["id"] != "trash"]
    assert nxt["repeat"] == "weekly" and not nxt["completed"] and nxt["title"] == "Take out the trash"
    assert datetime.fromisoformat(nxt["deadline"]) > datetime.now(timezone.utc)
    client.patch("/reminders/trash", json={"completed": False})
    assert [r["id"] for r in client.get("/reminders").json()] == ["trash"]


def test_completing_twice_never_makes_two(client):
    deadline = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    remember(client, "gym", "Gym", deadline=deadline, repeat="daily")
    client.patch("/reminders/gym", json={"completed": True})
    client.patch("/reminders/gym", json={"completed": True})
    assert len(client.get("/reminders").json()) == 2


def test_a_one_off_reminder_does_not_repeat(client):
    remember(client, "once", "Once", deadline="2026-10-29T13:00:00Z")
    client.patch("/reminders/once", json={"completed": True})
    assert len(client.get("/reminders").json()) == 1


def test_saying_it_is_done_also_makes_the_next(client, model):
    deadline = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    remember(client, "trash", "Take out the trash", deadline=deadline, repeat="weekly")
    say(client, "hello there")
    ref = next(l.split(":")[0] for l in model.prompts[-1].splitlines() if "Take out the trash" in l)
    model.reply = {"reminders": [{"action": "complete", "ref": ref}]}
    say(client, "I took out the trash")
    rows = db_of(client).exec(select(ReminderRow)).all()
    assert sorted((r.completed, r.repeat_of) for r in rows) == [(False, "trash"), (True, None)]


def test_the_model_can_set_a_repeat_only_with_a_time(client, model):
    model.reply = {"reminders": [
        {"title": "Take out the trash", "deadline": "2026-11-02T09:00:00-05:00", "triggerType": "time", "repeat": "weekly"},
        {"title": "Water plants", "deadline": None, "triggerType": "time", "repeat": "daily"},
        {"title": "Call Dad", "deadline": "2026-11-02T09:00:00-05:00", "triggerType": "time", "repeat": "hourly"},
    ]}
    r = say(client, "take out the trash every Monday, water the plants every day and call dad monday")
    assert {x["title"]: x.get("repeat") for x in r["reminders"]} == {"Take out the trash": "weekly", "Water plants": None, "Call Dad": None}
