"""The one place the backend talks to a model.

Everything goes through Nebius Token Factory's OpenAI-compatible API, so
swapping models is a config change and not a code change.
"""

import json

import openai
from openai import OpenAI

from app import config, usage


class LLMError(Exception):
    pass


class BudgetError(LLMError):
    """A spend limit was reached, so the call was refused before reaching Nebius."""


class ReplyError(LLMError):
    """The model answered, but not usably for this input (refused it, or replied with
    no usable JSON). Unlike an outage this is about the text, so a queued chunk that
    keeps getting it is given up on instead of retried forever."""


class RequestRefused(ReplyError):
    """Nebius rejected the request itself (400/422). That can be this chunk, or our own
    config (an option the model doesn't support), which would refuse every chunk. A
    queued chunk only pays for it once another call has shown the config is fine."""


_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        if not config.NEBIUS_API_KEY:
            raise LLMError("NEBIUS_API_KEY is not set")
        _client = OpenAI(base_url=config.NEBIUS_BASE_URL, api_key=config.NEBIUS_API_KEY, timeout=30, max_retries=1)
    return _client


def extract_json(text: str) -> dict:
    """Pull the JSON object out of a reply.

    Nemotron 3 Super is a reasoning model and can put thinking text before the
    answer, so take the outermost {...} rather than trusting the whole reply.
    """
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise ReplyError("model reply had no JSON object")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise ReplyError(f"model reply was not valid JSON: {e}") from e


def chat_json(messages: list[dict], model: str | None = None) -> dict:
    try:
        usage.reserve_call()
    except usage.BudgetExceeded as e:
        raise BudgetError(str(e)) from e
    except Exception as e:  # noqa: BLE001
        # Can't count the spend, so don't spend. Fail closed, but as an LLMError so
        # the caller's fallback (queue, or keep the typed text) still runs.
        raise LLMError(f"spend guard unavailable: {type(e).__name__}") from e
    try:
        response = get_client().chat.completions.create(
            model=model or config.NEBIUS_MODEL,
            messages=messages,
            temperature=0,
            response_format={"type": "json_object"},
        )
    except LLMError:
        raise
    except (openai.BadRequestError, openai.UnprocessableEntityError) as e:
        # Nebius was reachable and refused the request: this input, or our config.
        raise RequestRefused(f"Nebius refused the request: {type(e).__name__}") from e
    except Exception as e:
        # Connection, timeout, rate limit, server error: the model may be down.
        raise LLMError(f"Nebius request failed: {type(e).__name__}") from e
    try:
        content = response.choices[0].message.content or ""
    except (AttributeError, IndexError, TypeError) as e:
        # An empty/None `choices` (content filtering): it answered, with nothing.
        raise ReplyError(f"Nebius reply had no message: {type(e).__name__}") from e
    try:
        usage.record_tokens(response.usage.total_tokens)
    except Exception:
        pass  # a missing usage block must never lose a good reply
    return extract_json(content)
