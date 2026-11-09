"""Billing orchestration: checkout and idempotent webhook processing, independent of any one provider."""
from datetime import datetime, timezone

from app.billing import store
from app.billing.plans import PLANS
from app.billing.providers.base import NormalizedEvent
from app.billing.providers.registry import get_provider
from app.core.config import settings
from app.core.logger import logger
from app.db.models import TABLES


async def start_checkout(*, provider_name: str, scope_id: str, plan: str, email: str) -> dict:
    session = await get_provider(provider_name).create_checkout_session(
        scope_id=scope_id,
        plan=plan,
        customer_email=email,
        success_url=f"{settings.FRONTEND_URL}/billing?checkout=success",
        cancel_url=f"{settings.FRONTEND_URL}/billing?checkout=cancelled",
    )
    return {"id": session.id, "url": session.url, "provider": session.provider}


async def _scope_for(event: NormalizedEvent) -> str | None:
    if event.scope_id:
        return event.scope_id
    if event.subscription_id:
        sub = await TABLES["subscriptions"].get(provider_subscription_id=event.subscription_id)
        if sub:
            return sub["scope_id"]
    return None


async def _apply(provider: str, ev: NormalizedEvent) -> str:
    if ev.kind == "ignored":
        return "ignored"
    scope = await _scope_for(ev)
    if not scope:
        logger.warning("Billing event %s/%s has no resolvable workspace; ignoring", provider, ev.event_id)
        return "ignored"

    if ev.kind in ("subscription_updated", "subscription_canceled"):
        fields: dict = {"provider": provider, "status": ev.status or "active"}
        if ev.plan in PLANS:
            fields["plan"] = ev.plan
        for key, val in (("customer_id", ev.customer_id), ("provider_subscription_id", ev.subscription_id)):
            if val:
                fields[key] = val
        if ev.period_end:
            fields["current_period_end"] = datetime.fromtimestamp(ev.period_end, tz=timezone.utc).replace(tzinfo=None)
        await store.upsert_subscription(scope, fields)
        if fields["status"] in ("active", "trialing"):
            await store.ensure_period_grant(scope, await store.get_plan_for_scope(scope))
        return "subscription_synced"

    if ev.kind == "invoice_paid":
        inv = ev.invoice
        if inv.get("id"):
            await store.record_invoice(
                scope, provider, inv["id"],
                {"amount": inv.get("amount", 0), "currency": inv.get("currency", "usd"),
                 "status": "paid", "url": inv.get("url")},
            )
        return "invoice_recorded"

    if ev.kind == "invoice_failed":
        await store.upsert_subscription(scope, {"status": "past_due"})
        return "payment_failed"
    return "ignored"


async def handle_webhook(provider_name: str, payload: bytes, headers: dict) -> dict:
    """Verify, de-duplicate and apply one webhook. Raises InvalidSignature before touching any state.

    If applying fails the event claim is released so the provider's retry gets processed.
    """
    provider = get_provider(provider_name)
    provider.verify_webhook(payload, headers)
    event = provider.parse_event(payload, headers)
    if not await store.claim_event(provider_name, event.event_id):
        return {"status": "duplicate"}
    try:
        outcome = await _apply(provider_name, event)
    except Exception:
        await store.release_event(provider_name, event.event_id)
        raise
    return {"status": "ok", "outcome": outcome}
