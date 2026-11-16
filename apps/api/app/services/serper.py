import json
from contextvars import ContextVar

import httpx

from app.core.config import settings
from app import usage

# Per-request/per-pipeline Serper key. Entry points (lead pipeline, competitor
# pipeline, intent analysis) set this from the requesting user's stored key so
# that all nested Serper calls use the correct key without threading it through
# every function. Missing owner credentials fail before contacting Serper.
current_serper_key: ContextVar[str | None] = ContextVar("current_serper_key", default=None)


def get_serper_key() -> str:
    """Return the active owner's key; never borrow an operator credential."""
    key = current_serper_key.get()
    if key:
        return key
    raise RuntimeError('Add your Serper API key in Account settings before running a search.')


async def fetch_leads_from_serper(query: str) -> dict:
    usage.count("serper")
    payload = json.dumps({"q": query})
    headers = {
        'X-API-KEY': get_serper_key(),
        'Content-Type': 'application/json'
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(settings.SERPER_URL, headers=headers, content=payload)
        response.raise_for_status()
        return response.json()
