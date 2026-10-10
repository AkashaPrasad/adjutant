"""Async client for Meta Muse Spark 1.3 Contributor (OpenAI-compatible Chat Completions).

API notes: reasoning model (`reasoning_effort` minimal|low|medium|high), `max_completion_tokens`
instead of `max_tokens`, and `stream`/`stop`/`n`/`logprobs` are rejected. Structured output uses
response_format={"type": "json_schema"}; if the server rejects the schema we retry once with the
schema in the prompt and parse JSON out of the text.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from typing import Any

import httpx

from .config import Settings

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504, 529})


class LLMUnavailable(RuntimeError):
    """No API key is configured."""


class LLMError(RuntimeError):
    """The upstream call failed or returned something unusable."""


def extract_json(text: str) -> Any:
    text = (text or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if starts:
        start, end = min(starts), max(text.rfind("}"), text.rfind("]"))
        if end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise LLMError("model did not return valid JSON")


class MuseClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout_s: float = 90.0,
        max_retries: int = 4,
        backoff_base_s: float = 1.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self._transport = transport

    @classmethod
    def from_settings(cls, settings: Settings) -> MuseClient:
        return cls(
            api_key=settings.muse_api_key,
            base_url=settings.muse_base_url,
            model=settings.muse_model,
            timeout_s=settings.llm_timeout_s,
            max_retries=settings.llm_max_retries,
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _delay(self, attempt: int, response: httpx.Response | None) -> float:
        if response is not None:
            try:
                return min(float(response.headers.get("retry-after", "")), 30.0)
            except ValueError:
                pass
        return min(self.backoff_base_s * 2**attempt, 20.0) * (0.5 + random.random())

    async def complete_json(
        self,
        messages: list[dict[str, Any]],
        *,
        schema: dict[str, Any],
        name: str,
        effort: str = "low",
        max_completion_tokens: int = 4000,
    ) -> Any:
        if not self.configured:
            raise LLMUnavailable("MUSE_API_KEY is not configured")
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "reasoning_effort": effort,
            "max_completion_tokens": max_completion_tokens,
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema}},
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        attempt = 0
        last_error = "no attempt made"
        async with httpx.AsyncClient(timeout=self.timeout_s, transport=self._transport) as client:
            while True:
                resp: httpx.Response | None = None
                try:
                    resp = await client.post(self.url, json=payload, headers=headers)
                except httpx.TransportError as e:
                    last_error = f"transport error: {e}"
                if resp is not None:
                    body = resp.text
                    if (
                        resp.status_code == 400
                        and "response_format" in payload
                        and ("response_format" in body or "schema" in body)
                    ):
                        # Schema rejected: retry once with the schema in the prompt instead.
                        payload.pop("response_format")
                        payload["messages"] = [
                            *messages,
                            {
                                "role": "user",
                                "content": "Respond with only a JSON object matching this "
                                "JSON Schema:\n" + json.dumps(schema),
                            },
                        ]
                        continue
                    if resp.status_code not in RETRY_STATUSES:
                        return self._parse(resp)
                    last_error = f"HTTP {resp.status_code}: {body[:200]}"
                if attempt >= self.max_retries:
                    raise LLMError(f"Muse API call failed after {attempt + 1} attempt(s) ({last_error})")
                await asyncio.sleep(self._delay(attempt, resp))
                attempt += 1

    @staticmethod
    def _parse(resp: httpx.Response) -> Any:
        if resp.status_code >= 400:
            raise LLMError(f"Muse API returned HTTP {resp.status_code}: {resp.text[:300]}")
        try:
            content = resp.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMError("unexpected response shape from Muse API") from e
        if not content:
            raise LLMError("Muse API returned an empty completion")
        return extract_json(content)
