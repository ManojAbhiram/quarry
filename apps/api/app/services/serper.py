import json
from contextvars import ContextVar

import httpx

from app.core.config import settings
from app.core.logger import logger

# Per-request/per-pipeline Serper key. Entry points (lead pipeline, competitor
# pipeline, intent analysis) set this from the requesting user's stored key so
# that all nested Serper calls use the correct key without threading it through
# every function. Falls back to the global key when unset.
current_serper_key: ContextVar[str | None] = ContextVar("current_serper_key", default=None)


def get_serper_key() -> str:
    """Return the active Serper key: the per-user key if set, else the global one."""
    key = current_serper_key.get()
    if key:
        return key
    logger.warning("Serper call without a per-user key: falling back to the operator's global key (check the caller)")
    return settings.SERPER_API_KEY


async def fetch_leads_from_serper(query: str) -> dict:
    payload = json.dumps({"q": query})
    headers = {
        'X-API-KEY': get_serper_key(),
        'Content-Type': 'application/json'
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(settings.SERPER_URL, headers=headers, content=payload)
        response.raise_for_status()
        return response.json()


async def validate_serper_key(key: str) -> bool:
    """Best-effort check that a Serper key works (one minimal search request)."""
    if not key:
        return False
    headers = {'X-API-KEY': key, 'Content-Type': 'application/json'}
    payload = json.dumps({"q": "test"})
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(settings.SERPER_URL, headers=headers, content=payload)
        return response.status_code == 200
    except httpx.HTTPError:
        return False
