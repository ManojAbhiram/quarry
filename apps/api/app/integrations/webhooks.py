"""Outgoing webhooks: HMAC-signed JSON POSTs with exponential-backoff retries. The HTTP edge is the `poster` port."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Protocol

import httpx

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret, encrypt_secret
from app.core.url_guard import UnsafeURLError, check_url
from app.db.models import TABLES
from app.outreach import deps

_hooks = TABLES["webhooks"]
_deliveries = TABLES["webhook_deliveries"]

EVENTS = ("outreach.reply", "outreach.bounce", "outreach.unsubscribe", "signal.detected", "alert.saved_search",
          "leads.export", "webhook.test")
BACKOFF_MINUTES = (1, 5, 30, 120, 720)  # after attempt 1..5; a sixth failure gives up
MAX_ATTEMPTS = len(BACKOFF_MINUTES) + 1


class HttpPoster(Protocol):
    async def post(self, url: str, body: bytes, headers: dict[str, str]) -> int: ...


class RealPoster:
    async def post(self, url: str, body: bytes, headers: dict[str, str]) -> int:
        await asyncio.to_thread(check_url, url)  # SSRF guard at send time (DNS may have changed since creation)
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            return (await client.post(url, content=body, headers=headers)).status_code


class _Ports:
    poster: HttpPoster = RealPoster()


ports = _Ports()


def sign(secret: str, timestamp: int, body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_signature(secret: str, header: str, body: bytes, tolerance: int = 300, now: int | None = None) -> bool:
    """Receiver-side helper (also used in tests/docs)."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
    except (ValueError, KeyError):
        return False
    if abs((now if now is not None else int(datetime.utcnow().timestamp())) - ts) > tolerance:
        return False
    return hmac.compare_digest(sign(secret, ts, body), header)


def validate_url(url: str) -> None:
    if not url.lower().startswith("https://") and not url.lower().startswith("http://"):
        raise ValueError("webhook URL must be http(s)")
    try:
        check_url(url)
    except UnsafeURLError as exc:
        raise ValueError(f"webhook URL is not allowed: {exc}") from exc


def public(hook: dict) -> dict:
    return {k: (v.isoformat() + "Z" if isinstance(v, datetime) else v) for k, v in hook.items() if k != "secret_enc"}


async def create_webhook(user_id: str, url: str, events: list[str], validate: bool = True) -> tuple[dict, str]:
    if validate:
        validate_url(url)
    bad = [e for e in events if e not in EVENTS and e != "*"]
    if bad:
        raise ValueError(f"unknown event(s): {', '.join(bad)}")
    secret = "whsec_" + secrets.token_urlsafe(24)
    doc = {"user_id": user_id, "url": url, "events": events or ["*"], "active": True,
           "secret_enc": encrypt_secret(secret), "created_at": datetime.utcnow()}
    doc["_id"] = await _hooks.insert(doc)
    return public(doc), secret


async def emit(owner_id: str, event: str, data: dict, only_webhook_id: str | None = None) -> int:
    """Queue a delivery for every matching active webhook (or just one). Returns how many were queued."""
    queued = 0
    for hook in await _hooks.find(_hooks.model.user_id == owner_id):
        if only_webhook_id and hook["_id"] != only_webhook_id:
            continue
        if not hook.get("active", True) or not ("*" in hook["events"] or event in hook["events"]):
            continue
        await _deliveries.insert({
            "webhook_id": hook["_id"], "status": "pending", "next_attempt_at": datetime.utcnow(), "event": event,
            "event_id": str(uuid.uuid4()), "payload": data, "attempts": 0, "created_at": datetime.utcnow(),
        })
        queued += 1
    if queued:
        await deps.enqueue("webhooks.deliver", {}, owner_id=owner_id)
    return queued


async def deliver_pending(now: datetime | None = None, limit: int = 100) -> dict:
    now = now or datetime.utcnow()
    out = {"delivered": 0, "retrying": 0, "failed": 0}
    rows = await _deliveries.find(_deliveries.model.status == "pending", _deliveries.model.next_attempt_at <= now,
                                  order_by=_deliveries.model.next_attempt_at, limit=limit)
    for d in rows:
        hook = await _hooks.get(_id=d["webhook_id"])
        if not hook or not hook.get("active", True):
            await _deliveries.update(d["_id"], {"status": "failed", "last_error": "webhook removed or disabled"})
            out["failed"] += 1
            continue
        body = json.dumps({"id": d["event_id"], "event": d["event"], "created_at": d["created_at"].isoformat() + "Z",
                           "data": d["payload"]}, separators=(",", ":"), default=str).encode()
        ts = int(now.timestamp())
        headers = {"Content-Type": "application/json", "User-Agent": "Quarry-Webhooks/1",
                   "X-Quarry-Event": d["event"], "X-Quarry-Delivery": d["event_id"],
                   "X-Quarry-Signature": sign(decrypt_secret(hook["secret_enc"]), ts, body)}
        attempts = d["attempts"] + 1
        error = None
        try:
            status = await ports.poster.post(hook["url"], body, headers)
            if 200 <= status < 300:
                await _deliveries.update(d["_id"], {"status": "delivered", "attempts": attempts, "delivered_at": now,
                                                    "last_status": status})
                out["delivered"] += 1
                continue
            error = f"HTTP {status}"
        except Exception as exc:  # noqa: BLE001 - any transport failure is retried
            error = str(exc)[:200]
        if attempts >= MAX_ATTEMPTS:
            await _deliveries.update(d["_id"], {"status": "failed", "attempts": attempts, "last_error": error})
            out["failed"] += 1
            logger.warning("Webhook delivery %s gave up: %s", d["_id"], error)
        else:
            await _deliveries.update(d["_id"], {"attempts": attempts, "last_error": error,
                                                "next_attempt_at": now + timedelta(minutes=BACKOFF_MINUTES[attempts - 1])})
            out["retrying"] += 1
    return out
