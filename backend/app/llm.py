"""The one place the backend talks to a model.

Everything goes through Nebius Token Factory's OpenAI-compatible API, so
swapping models is a config change and not a code change.
"""

import json

from openai import OpenAI

from app import config, usage


class LLMError(Exception):
    pass


class BudgetError(LLMError):
    """A spend limit was reached, so the call was refused before reaching Nebius."""


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
        raise LLMError("model reply had no JSON object")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise LLMError(f"model reply was not valid JSON: {e}") from e


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
        content = response.choices[0].message.content or ""
    except LLMError:
        raise
    except Exception as e:
        # Includes an empty/None `choices` (content filtering, provider errors).
        raise LLMError(f"Nebius request failed: {type(e).__name__}") from e
    try:
        usage.record_tokens(response.usage.total_tokens)
    except Exception:
        pass  # a missing usage block must never lose a good reply
    return extract_json(content)
