"""Turns a spoken request into an email draft (Module 09).

The backend never sends mail. It produces a draft and records whether the
person approved it; the phone opens its native composer for the actual send.
"""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from app import config, llm
from app.models import EmailDraft

SYSTEM_PROMPT = """You turn what a person said out loud into a short email draft they will review before anything is sent.

Current local time: {now_local} ({weekday}), timezone {tz}.

Return ONLY a JSON object: {{"email": {{...}}}}, or {{"email": null}} if the person is not asking to write or send an email or message.
The "email" object has:
- "toName": who they named ("Alex", "my professor", "Mom"), exactly as spoken, or null.
- "to": an email address ONLY if the person literally said one, else null. Never guess or build an address from a name.
- "subject": a short subject, 8 words or fewer.
- "body": 1 to 4 plain sentences written in the first person as the sender. Use only facts the person gave, in their own words where you can. Do not add details they did not say: no place ("in my apartment"), no cause, no time, no name, no promise, no extra politeness beyond a greeting. No placeholders in brackets, no signature, no subject line inside the body.
"""

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class NoEmailRequest(Exception):
    """The text was not a request to write an email."""


def build_messages(text: str, now: datetime, tz: ZoneInfo) -> list[dict]:
    local = now.astimezone(tz)
    system = SYSTEM_PROMPT.format(
        now_local=local.strftime("%Y-%m-%d %H:%M"), weekday=local.strftime("%A"), tz=str(tz)
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": text}]


def _clean(value, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value[:limit] or None


def _clean_body(value, limit: int = 10000) -> str | None:
    """Keep the model's line breaks (a greeting on its own line) but tidy spacing.

    The model sometimes returns the body as a list of lines instead of a string.
    """
    if isinstance(value, list):
        value = "\n".join(v for v in value if isinstance(v, str))
    if not isinstance(value, str):
        return None
    lines, blank = [], False
    for raw in value.replace("\r", "").split("\n"):
        line = " ".join(raw.split())
        if line:
            lines.append(line)
            blank = False
        elif lines and not blank:
            lines.append("")
            blank = True
    return "\n".join(lines).strip()[:limit] or None


def _spoken_address(candidate, source_text: str) -> str | None:
    """Keep an address only if it is well formed AND appears in what was said.

    This stops a model (or words injected into ambient speech) from supplying a
    recipient the person never named.
    """
    c = _clean(candidate, 320)
    if c and EMAIL_RE.match(c) and c.lower() in source_text.lower():
        return c
    return None


def draft_from_model(data: dict, source_text: str) -> EmailDraft:
    email = data.get("email")
    if not isinstance(email, dict):
        raise NoEmailRequest()
    subject, body = _clean(email.get("subject"), 300), _clean_body(email.get("body"))
    if not subject or not body:
        raise NoEmailRequest()
    return EmailDraft(
        to=_spoken_address(email.get("to"), source_text),
        to_name=_clean(email.get("toName"), 200),
        subject=subject,
        body=body,
    )


def draft_mock(text: str) -> EmailDraft:
    return EmailDraft(subject="Draft", body=text.strip()[:500])


def make_draft(text: str, now: datetime, tz: ZoneInfo) -> EmailDraft:
    """Raises NoEmailRequest if it isn't an email request, llm.LLMError if the model fails."""
    if config.parser_mode() == "mock":
        return draft_mock(text)
    return draft_from_model(llm.chat_json(build_messages(text, now, tz)), text)
