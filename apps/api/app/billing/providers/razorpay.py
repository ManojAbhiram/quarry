"""Razorpay adapter over the REST API (no SDK). Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
RAZORPAY_PLAN_PRO, RAZORPAY_PLAN_TEAM."""
import hashlib
import hmac
import json
from typing import Optional

import httpx

from app.billing.providers.base import (
    CheckoutSession,
    InvalidSignature,
    NormalizedEvent,
    PaymentProvider,
    ProviderNotConfigured,
    env,
)

API = "https://api.razorpay.com/v1"

_STATUS = {
    "active": "active", "authenticated": "trialing", "pending": "past_due", "halted": "past_due",
    "created": "past_due", "cancelled": "canceled", "completed": "canceled", "expired": "canceled",
}


class RazorpayProvider(PaymentProvider):
    name = "razorpay"

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    def is_configured(self) -> bool:
        return bool(env("RAZORPAY_KEY_ID") and env("RAZORPAY_KEY_SECRET") and env("RAZORPAY_WEBHOOK_SECRET"))

    async def create_checkout_session(self, *, scope_id, plan, customer_email, success_url, cancel_url):
        key_id, secret, plan_id = env("RAZORPAY_KEY_ID"), env("RAZORPAY_KEY_SECRET"), env(f"RAZORPAY_PLAN_{plan.upper()}")
        if not (key_id and secret and plan_id):
            raise ProviderNotConfigured(f"Razorpay is not configured for the {plan} plan")
        body = {
            "plan_id": plan_id,
            "total_count": 120,
            "customer_notify": 1,
            "notes": {"scope_id": scope_id, "plan": plan, "email": customer_email},
        }
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            res = await client.post(f"{API}/subscriptions", json=body, auth=(key_id, secret))
        finally:
            if self._client is None:
                await client.aclose()
        if res.status_code >= 400:
            raise RuntimeError(f"Razorpay subscription creation failed ({res.status_code})")
        data = res.json()
        return CheckoutSession(id=data["id"], url=data["short_url"], provider=self.name)

    # X-Razorpay-Signature = hex hmac sha256 of the raw body with the webhook secret
    def verify_webhook(self, payload: bytes, headers: dict) -> None:
        secret = env("RAZORPAY_WEBHOOK_SECRET")
        if not secret:
            raise ProviderNotConfigured("RAZORPAY_WEBHOOK_SECRET is not set")
        sig = headers.get("x-razorpay-signature", "")
        expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        if not sig or not hmac.compare_digest(expected, sig):
            raise InvalidSignature("Razorpay signature mismatch")

    def parse_event(self, payload: bytes, headers: dict) -> NormalizedEvent:
        evt = json.loads(payload)
        typ = evt.get("event", "")
        # Razorpay sends a stable id per event in this header; fall back to a body hash so redelivery still dedupes.
        eid = headers.get("x-razorpay-event-id") or hashlib.sha256(payload).hexdigest()
        ents = (evt.get("payload") or {})
        sub = (ents.get("subscription") or {}).get("entity") or {}
        notes = sub.get("notes") or {}

        if typ.startswith("subscription."):
            canceled = typ in ("subscription.cancelled", "subscription.completed")
            return NormalizedEvent(
                eid, "subscription_canceled" if canceled else "subscription_updated",
                scope_id=notes.get("scope_id"), plan=notes.get("plan"),
                status=_STATUS.get(sub.get("status", ""), "past_due"), customer_id=sub.get("customer_id"),
                subscription_id=sub.get("id"), period_end=sub.get("current_end"),
            )
        if typ in ("invoice.paid", "payment.failed"):
            inv = (ents.get("invoice") or {}).get("entity") or (ents.get("payment") or {}).get("entity") or {}
            return NormalizedEvent(
                eid, "invoice_paid" if typ == "invoice.paid" else "invoice_failed",
                subscription_id=inv.get("subscription_id") or sub.get("id"), customer_id=inv.get("customer_id"),
                invoice={
                    "id": inv.get("id"), "amount": inv.get("amount_paid") or inv.get("amount") or 0,
                    "currency": (inv.get("currency") or "INR").lower(),
                    "status": "paid" if typ == "invoice.paid" else "failed", "url": inv.get("short_url"),
                },
            )
        return NormalizedEvent(eid, "ignored")
