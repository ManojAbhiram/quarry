"""Optional lead scoring through the Claude Message Batches API with prompt caching (config flag, off by default).

The shared rubric is the cached system block, so every request in the batch reuses it at the cache-read price, and the
batch endpoint halves the per-token price again. Nothing here runs unless CLAUDE_BATCH_SCORING is true; the client is
a port so tests never touch the network.
"""
from __future__ import annotations

import json
from typing import Protocol

import httpx

from app.p3.config import p3_settings
from app.services.connections import current_connection

API = "https://api.anthropic.com/v1/messages/batches"

DEFAULT_RUBRIC = (
    "You score B2B sales leads 0-100 for fit against the ideal customer profile given in the user message. "
    "Consider industry, size, role relevance and buying signals. "
    'Reply with JSON only: {"score": <int 0-100>, "reason": "<one short sentence>"}.'
)


class BatchClient(Protocol):
    async def create(self, requests: list[dict]) -> str: ...

    async def status(self, batch_id: str) -> dict: ...

    async def results(self, batch_id: str) -> list[dict]: ...


class RealBatchClient:
    def __init__(self, api_key: str):
        self._h = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}

    async def create(self, requests: list[dict]) -> str:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(API, headers=self._h, json={"requests": requests})
            r.raise_for_status()
            return r.json()["id"]

    async def status(self, batch_id: str) -> dict:
        from urllib.parse import quote
        batch_id = quote(batch_id, safe='')
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{API}/{batch_id}", headers=self._h)
            r.raise_for_status()
            return r.json()

    async def results(self, batch_id: str) -> list[dict]:
        from urllib.parse import quote
        batch_id = quote(batch_id, safe='')
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(f"{API}/{batch_id}/results", headers=self._h)
            r.raise_for_status()
            return [json.loads(line) for line in r.text.splitlines() if line.strip()]


class _Ports:
    client: BatchClient | None = None


ports = _Ports()


class Disabled(RuntimeError):
    pass


def _client() -> BatchClient:
    if not p3_settings.claude_batch_scoring:
        raise Disabled("Claude batch scoring is disabled (set CLAUDE_BATCH_SCORING=true)")
    connection = current_connection.get()
    if not connection or connection.get('provider') != 'anthropic' or not connection.get('primary_model'):
        raise Disabled('Configure your own Anthropic connection and model in Account to use Claude batch scoring.')
    if ports.client:
        return ports.client
    return RealBatchClient(connection['api_key'])


def build_requests(leads: list[dict], icp: str, rubric: str = DEFAULT_RUBRIC, model: str | None = None) -> list[dict]:
    """One batch request per lead. The rubric is a cache_control'd system block shared by all of them."""
    connection = current_connection.get() or {}
    model = model or connection.get('fast_model') or connection.get('primary_model')
    if not model:
        raise Disabled('Select an Anthropic model in Account settings before scoring.')
    system = [{"type": "text", "text": rubric, "cache_control": {"type": "ephemeral"}}]
    out = []
    for lead in leads:
        facts = {k: lead.get(k) for k in ("title", "url", "snippet", "industry", "location") if lead.get(k)}
        out.append({
            "custom_id": str(lead["_id"]),
            "params": {
                "model": model, "max_tokens": 200, "system": system,
                "messages": [{"role": "user", "content": f"ICP:\n{icp}\n\nLead:\n{json.dumps(facts)}"}],
            },
        })
    return out


async def submit(leads: list[dict], icp: str) -> str:
    client = _client()
    return await client.create(build_requests(leads, icp))


def parse_results(rows: list[dict]) -> dict[str, dict]:
    scores: dict[str, dict] = {}
    for row in rows:
        res = row.get("result") or {}
        if res.get("type") != "succeeded":
            continue
        text = "".join(b.get("text", "") for b in (res.get("message") or {}).get("content", []) if b.get("type") == "text")
        try:
            data = json.loads(text[text.index("{"): text.rindex("}") + 1])
            scores[row["custom_id"]] = {"score": max(0, min(100, int(data["score"]))), "reason": str(data.get("reason", ""))[:200]}
        except (ValueError, KeyError, TypeError):
            continue
    return scores


async def collect(batch_id: str) -> dict:
    client = _client()
    st = await client.status(batch_id)
    if st.get("processing_status") != "ended":
        return {"status": st.get("processing_status", "in_progress"), "scores": {}}
    return {"status": "ended", "scores": parse_results(await client.results(batch_id))}
