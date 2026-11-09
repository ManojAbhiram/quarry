"""REST hooks for Zapier / Make: subscribers register a target URL for an event and receive signed JSON POSTs.

Events: lead.created, list.updated. Delivery is best-effort with a few retries; a hook that keeps failing is disabled.
"""
import asyncio
import hashlib
import hmac
import json
import secrets
from datetime import datetime
from typing import Optional

import httpx

from app.billing.store import personal_scope
from app.core.logger import logger
from app.core.url_guard import httpx_request_guard
from app.db.growth_models import OrgMember, WebhookSubscription
from app.db.models import TABLES

EVENTS = ("lead.created", "list.updated")
MAX_CONSECUTIVE_FAILURES = 10
DELIVERY_ATTEMPTS = 3

SAMPLES = {
    "lead.created": {"event": "lead.created", "lead": {"id": "lead_123", "title": "Acme Inc", "url": "https://acme.com",
                                                       "email": "jane@acme.com", "match_score": 87.0}},
    "list.updated": {"event": "list.updated", "list": {"id": "list_123", "name": "Hot leads", "lead_count": 12},
                     "change": "leads_added"},
}

_pending: set[asyncio.Task] = set()


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def subscribe(scope_id: str, event: str, target_url: str, user_id: str) -> dict:
    doc = {"scope_id": scope_id, "event": event, "target_url": target_url, "secret": secrets.token_urlsafe(24),
           "created_by": user_id, "failures": 0, "active": True, "created_at": datetime.utcnow()}
    doc["_id"] = await TABLES["webhook_subscriptions"].insert(doc)
    return doc


async def list_subscriptions(scope_id: str) -> list[dict]:
    return await TABLES["webhook_subscriptions"].find(WebhookSubscription.scope_id == scope_id)


async def unsubscribe(scope_id: str, hook_id: str) -> bool:
    hook = await TABLES["webhook_subscriptions"].get(_id=hook_id, scope_id=scope_id)
    return bool(hook) and await TABLES["webhook_subscriptions"].delete(hook_id)


async def _scopes_for_user(user_id: str) -> list[str]:
    orgs = [m["org_id"] for m in await TABLES["org_members"].find(OrgMember.user_id == str(user_id))]
    return [personal_scope(user_id), *orgs]


async def deliver(hook: dict, payload: dict, client: Optional[httpx.AsyncClient] = None) -> bool:
    body = json.dumps(payload, default=str).encode()
    headers = {"Content-Type": "application/json", "X-Quarry-Event": payload.get("event", ""),
               "X-Quarry-Signature": sign(hook["secret"], body)}
    own = client is None
    client = client or httpx.AsyncClient(timeout=10, event_hooks={"request": [httpx_request_guard]})
    try:
        for attempt in range(DELIVERY_ATTEMPTS):
            try:
                res = await client.post(hook["target_url"], content=body, headers=headers)
                if res.status_code < 300:
                    return True
                if res.status_code == 410:  # Zapier signals "unsubscribed"
                    return False
            except Exception as exc:  # network, SSRF guard, timeout: all count as a failed attempt
                logger.info("Hook delivery attempt %d to %s failed: %s", attempt + 1, hook["target_url"], exc.__class__.__name__)
            await asyncio.sleep(0.2 * (attempt + 1))
        return False
    finally:
        if own:
            await client.aclose()


async def emit_event(user_id: str, event: str, data: dict) -> int:
    """Deliver `event` to every active subscription visible to this user. Returns the number delivered."""
    payload = {"event": event, **data, "emitted_at": datetime.utcnow().isoformat()}
    delivered = 0
    for scope in await _scopes_for_user(user_id):
        for hook in await TABLES["webhook_subscriptions"].find(
            WebhookSubscription.scope_id == scope, WebhookSubscription.event == event
        ):
            if not hook.get("active", True):
                continue
            ok = await deliver(hook, payload)
            failures = 0 if ok else hook.get("failures", 0) + 1
            await TABLES["webhook_subscriptions"].update(
                hook["_id"], {"failures": failures, "active": failures < MAX_CONSECUTIVE_FAILURES,
                              "last_delivery_at": datetime.utcnow(), "last_ok": ok}
            )
            delivered += ok
    return delivered


def schedule_event(user_id: str, event: str, data: dict) -> None:
    """Fire-and-forget emit that can never break the caller (used from request handlers and the lead pipeline)."""

    async def run():
        try:
            await emit_event(str(user_id), event, data)
        except Exception as exc:
            logger.warning("emit %s failed: %s", event, exc)

    try:
        task = asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def drain() -> None:
    """Wait for scheduled events (tests, graceful shutdown)."""
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)
