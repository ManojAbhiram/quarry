"""Billing orchestration: checkout and idempotent webhook processing, independent of any one provider."""
from datetime import datetime, timezone

from app.billing import store
from app.billing.plans import PLANS, TOPUP_TARGETS, topup_price_usd
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


class TopupError(ValueError):
    pass


async def apply_topup(scope_id: str, user_id: str | None, credits: int, target: str, ref: str) -> bool:
    """Credit a paid top-up. Request credits go to the billing ledger (idempotent on `ref`); email lookup credits go
    to the buying user's enrichment balance."""
    if target not in TOPUP_TARGETS or credits <= 0:
        raise TopupError("Invalid top-up")
    if target == "requests":
        return await store.grant_credits(scope_id, credits, "topup", ref=ref, note=f"Top-up: {credits} request credits")
    from app.waterfall import service as waterfall  # lazy import keeps billing importable on its own

    if not user_id:
        raise TopupError("A user is required for email lookup credits")
    await waterfall.grant(user_id, credits, f"Top-up: {credits} email lookup credits")
    return True


async def start_topup(*, provider_name: str, scope_id: str, user_id: str, credits: int, target: str, email: str) -> dict:
    price = topup_price_usd(credits)
    if price is None or target not in TOPUP_TARGETS:
        raise TopupError("Choose one of the available credit packs")
    provider = get_provider(provider_name)
    session = await provider.create_topup_session(
        scope_id=scope_id, user_id=user_id, credits=credits, price_usd=price, target=target, customer_email=email,
        success_url=f"{settings.FRONTEND_URL}/billing?topup=success",
        cancel_url=f"{settings.FRONTEND_URL}/billing?topup=cancelled",
    )
    settled = False
    if provider.settles_immediately:
        await apply_topup(scope_id, user_id, credits, target, ref=f"topup:{provider_name}:{session.id}")
        settled = True
    return {"id": session.id, "url": session.url, "provider": session.provider, "settled": settled,
            "credits": credits, "target": target}


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

    if ev.kind == "topup_paid":
        t = ev.topup
        applied = await apply_topup(scope, t.get("user_id"), int(t.get("credits") or 0), t.get("target") or "requests",
                                    ref=f"topup:{provider}:{ev.event_id}")
        return "topup_credited" if applied else "topup_duplicate"

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
