"""Stripe adapter over the plain REST API (no SDK). Keys come from env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM."""
import hashlib
import hmac
import json
import time
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

API = "https://api.stripe.com/v1"
TOLERANCE_SECONDS = 300


def _status(stripe_status: str) -> str:
    return {"active": "active", "trialing": "trialing", "past_due": "past_due", "unpaid": "past_due"}.get(
        stripe_status, "canceled"
    )


class StripeProvider(PaymentProvider):
    name = "stripe"

    def __init__(self, client: Optional[httpx.AsyncClient] = None, now=time.time):
        self._client = client
        self._now = now

    def is_configured(self) -> bool:
        return bool(env("STRIPE_SECRET_KEY") and env("STRIPE_WEBHOOK_SECRET"))

    async def create_checkout_session(self, *, scope_id, plan, customer_email, success_url, cancel_url):
        key, price = env("STRIPE_SECRET_KEY"), env(f"STRIPE_PRICE_{plan.upper()}")
        if not key or not price:
            raise ProviderNotConfigured(f"Stripe is not configured for the {plan} plan")
        form = {
            "mode": "subscription",
            "line_items[0][price]": price,
            "line_items[0][quantity]": "1",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": scope_id,
            "customer_email": customer_email,
            "metadata[scope_id]": scope_id,
            "metadata[plan]": plan,
            "subscription_data[metadata][scope_id]": scope_id,
            "subscription_data[metadata][plan]": plan,
        }
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            res = await client.post(f"{API}/checkout/sessions", data=form, auth=(key, ""))
        finally:
            if self._client is None:
                await client.aclose()
        if res.status_code >= 400:
            raise RuntimeError(f"Stripe checkout failed ({res.status_code})")
        body = res.json()
        return CheckoutSession(id=body["id"], url=body["url"], provider=self.name)

    # Stripe-Signature: t=<unix>,v1=<hex hmac sha256 of "<t>.<payload>">[,v1=...]
    def verify_webhook(self, payload: bytes, headers: dict) -> None:
        secret = env("STRIPE_WEBHOOK_SECRET")
        if not secret:
            raise ProviderNotConfigured("STRIPE_WEBHOOK_SECRET is not set")
        header = headers.get("stripe-signature", "")
        parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
        ts = next((v for k, v in parts if k == "t"), None)
        sigs = [v for k, v in parts if k == "v1"]
        if not ts or not sigs or not ts.isdigit():
            raise InvalidSignature("Missing or malformed Stripe-Signature")
        if abs(self._now() - int(ts)) > TOLERANCE_SECONDS:
            raise InvalidSignature("Stripe signature timestamp outside tolerance")
        expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, s) for s in sigs):
            raise InvalidSignature("Stripe signature mismatch")

    def parse_event(self, payload: bytes, headers: dict) -> NormalizedEvent:
        evt = json.loads(payload)
        eid, typ = evt.get("id", ""), evt.get("type", "")
        obj = (evt.get("data") or {}).get("object") or {}
        meta = obj.get("metadata") or {}

        if typ == "checkout.session.completed":
            return NormalizedEvent(
                eid, "subscription_updated",
                scope_id=obj.get("client_reference_id") or meta.get("scope_id"),
                plan=meta.get("plan"), status="active",
                customer_id=obj.get("customer"), subscription_id=obj.get("subscription"),
            )
        if typ in ("customer.subscription.created", "customer.subscription.updated"):
            return NormalizedEvent(
                eid, "subscription_updated", scope_id=meta.get("scope_id"), plan=meta.get("plan"),
                status=_status(obj.get("status", "")), customer_id=obj.get("customer"),
                subscription_id=obj.get("id"), period_end=obj.get("current_period_end"),
            )
        if typ == "customer.subscription.deleted":
            return NormalizedEvent(
                eid, "subscription_canceled", scope_id=meta.get("scope_id"), plan=meta.get("plan"),
                status="canceled", customer_id=obj.get("customer"), subscription_id=obj.get("id"),
            )
        if typ in ("invoice.paid", "invoice.payment_failed"):
            return NormalizedEvent(
                eid, "invoice_paid" if typ == "invoice.paid" else "invoice_failed",
                customer_id=obj.get("customer"), subscription_id=obj.get("subscription"),
                invoice={
                    "id": obj.get("id"), "amount": obj.get("amount_paid") or obj.get("amount_due") or 0,
                    "currency": obj.get("currency", "usd"), "status": "paid" if typ == "invoice.paid" else "failed",
                    "url": obj.get("hosted_invoice_url"),
                },
            )
        return NormalizedEvent(eid, "ignored")
