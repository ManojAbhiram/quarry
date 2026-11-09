import hashlib
import hmac
import json
import time

import httpx
import pytest

from app.billing import store
from app.billing.providers.base import CheckoutSession, InvalidSignature, PaymentProvider
from app.billing.providers.razorpay import RazorpayProvider
from app.billing.providers.registry import reset_providers, set_provider
from app.billing.providers.stripe import StripeProvider

STRIPE_SECRET = "whsec_test_fake"
RZP_SECRET = "rzp_whsec_fake"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", STRIPE_SECRET)
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_pro_fake")
    monkeypatch.setenv("STRIPE_PRICE_TEAM", "price_team_fake")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_key_fake")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "rzp_secret_fake")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", RZP_SECRET)
    monkeypatch.setenv("RAZORPAY_PLAN_PRO", "plan_pro_fake")
    yield
    reset_providers()


def stripe_headers(payload: bytes, secret=STRIPE_SECRET, ts=None):
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return {"stripe-signature": f"t={ts},v1={sig}"}


def stripe_event(eid, typ, obj):
    return json.dumps({"id": eid, "type": typ, "data": {"object": obj}}).encode()


def rzp_headers(payload: bytes, eid="evt_1", secret=RZP_SECRET):
    return {"x-razorpay-signature": hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest(),
            "x-razorpay-event-id": eid}


# -- signature verification --------------------------------------------------------------------------------------

def test_stripe_signature_valid_invalid_and_stale():
    p = StripeProvider()
    body = stripe_event("e1", "ping", {})
    p.verify_webhook(body, stripe_headers(body))
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body, stripe_headers(body, secret="wrong"))
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body + b" ", stripe_headers(body))  # tampered body
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body, stripe_headers(body, ts=int(time.time()) - 3600))
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body, {})


def test_razorpay_signature():
    p = RazorpayProvider()
    body = b'{"event":"x"}'
    p.verify_webhook(body, rzp_headers(body))
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body, rzp_headers(body, secret="nope"))
    with pytest.raises(InvalidSignature):
        p.verify_webhook(body, {})


# -- checkout (HTTP mocked) -------------------------------------------------------------------------------------

async def test_stripe_checkout_request_shape():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["body"], seen["auth"] = str(request.url), request.content.decode(), request.headers["authorization"]
        return httpx.Response(200, json={"id": "cs_1", "url": "https://checkout.stripe.test/cs_1"})

    p = StripeProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    s = await p.create_checkout_session(scope_id="org-1", plan="pro", customer_email="a@b.c", success_url="s", cancel_url="c")
    assert s.url.endswith("cs_1") and seen["url"].endswith("/checkout/sessions")
    assert "price_pro_fake" in seen["body"] and "client_reference_id=org-1" in seen["body"]
    assert seen["auth"].startswith("Basic ")


async def test_razorpay_checkout_request_shape():
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "sub_1", "short_url": "https://rzp.test/sub_1"})

    p = RazorpayProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    s = await p.create_checkout_session(scope_id="user:u", plan="pro", customer_email="a@b.c", success_url="s", cancel_url="c")
    assert s.url == "https://rzp.test/sub_1" and seen["body"]["plan_id"] == "plan_pro_fake"
    assert seen["body"]["notes"]["scope_id"] == "user:u"


# -- webhook handling over HTTP: sync + idempotency -------------------------------------------------------------

async def _post_stripe(api, body):
    return await api.post("/api/billing/webhooks/stripe", content=body, headers=stripe_headers(body))


async def test_webhook_rejects_bad_signature_and_changes_nothing(api):
    body = stripe_event("e_bad", "checkout.session.completed",
                        {"client_reference_id": "user:x", "metadata": {"plan": "pro"}, "subscription": "sub_1"})
    r = await api.post("/api/billing/webhooks/stripe", content=body, headers={"stripe-signature": "t=1,v1=00"})
    assert r.status_code == 400
    assert await store.get_subscription("user:x") is None


async def test_checkout_completed_upgrades_plan_once(api):
    body = stripe_event("e_up", "checkout.session.completed",
                        {"client_reference_id": "user:u1", "customer": "cus_1", "subscription": "sub_1",
                         "metadata": {"plan": "pro", "scope_id": "user:u1"}})
    assert (await _post_stripe(api, body)).json() == {"status": "ok", "outcome": "subscription_synced"}
    assert (await _post_stripe(api, body)).json() == {"status": "duplicate"}  # redelivery is a no-op
    assert (await store.get_plan_for_scope("user:u1")).id == "pro"
    assert await store.credit_balance("user:u1") == 500  # granted exactly once
    grants = [e for e in await store.ledger_entries("user:u1") if e["kind"] == "grant"]
    assert len(grants) == 1


async def test_same_state_new_event_does_not_double_grant(api):
    obj = {"client_reference_id": "user:u2", "subscription": "sub_2", "metadata": {"plan": "pro"}}
    await _post_stripe(api, stripe_event("e_a", "checkout.session.completed", obj))
    upd = {"id": "sub_2", "status": "active", "customer": "cus", "metadata": {"scope_id": "user:u2", "plan": "pro"}}
    await _post_stripe(api, stripe_event("e_b", "customer.subscription.updated", upd))
    assert await store.credit_balance("user:u2") == 500


async def test_cancellation_downgrades_to_free(api):
    await _post_stripe(api, stripe_event("e1", "checkout.session.completed",
                                         {"client_reference_id": "user:u3", "subscription": "sub_3", "metadata": {"plan": "team"}}))
    assert (await store.get_plan_for_scope("user:u3")).id == "team"
    gone = {"id": "sub_3", "status": "canceled", "metadata": {"scope_id": "user:u3", "plan": "team"}}
    await _post_stripe(api, stripe_event("e2", "customer.subscription.deleted", gone))
    assert (await store.get_plan_for_scope("user:u3")).id == "free"


async def test_invoice_paid_recorded_once_and_listed(api, signup):
    h, uid = await signup("bill@x.com")
    scope = f"user:{uid}"
    await _post_stripe(api, stripe_event("e1", "checkout.session.completed",
                                         {"client_reference_id": scope, "subscription": "sub_9", "metadata": {"plan": "pro"}}))
    inv = {"id": "in_1", "subscription": "sub_9", "amount_paid": 4900, "currency": "usd", "hosted_invoice_url": "https://x.test/i"}
    await _post_stripe(api, stripe_event("e2", "invoice.paid", inv))
    await _post_stripe(api, stripe_event("e3", "invoice.paid", inv))  # different event id, same invoice
    rows = (await api.get("/api/billing/invoices", headers=h)).json()["invoices"]
    assert len(rows) == 1 and rows[0]["amount"] == 4900 and rows[0]["status"] == "paid"


async def test_failed_handling_releases_claim_so_retry_works(api, monkeypatch):
    body = stripe_event("e_retry", "checkout.session.completed",
                        {"client_reference_id": "user:u5", "subscription": "s5", "metadata": {"plan": "pro"}})
    real = store.upsert_subscription

    async def boom(*a, **k):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(store, "upsert_subscription", boom)
    with pytest.raises(RuntimeError):
        await _post_stripe(api, body)
    monkeypatch.setattr(store, "upsert_subscription", real)
    assert (await _post_stripe(api, body)).json()["status"] == "ok"
    assert (await store.get_plan_for_scope("user:u5")).id == "pro"


async def test_razorpay_webhook_activates_subscription(api):
    body = json.dumps({"event": "subscription.activated", "payload": {"subscription": {"entity": {
        "id": "sub_r1", "status": "active", "customer_id": "cust_1", "notes": {"scope_id": "user:r1", "plan": "pro"}}}}}).encode()
    r = await api.post("/api/billing/webhooks/razorpay", content=body, headers=rzp_headers(body, "evt_r1"))
    assert r.json()["status"] == "ok"
    assert (await store.get_plan_for_scope("user:r1")).id == "pro"
    dup = await api.post("/api/billing/webhooks/razorpay", content=body, headers=rzp_headers(body, "evt_r1"))
    assert dup.json() == {"status": "duplicate"}


async def test_unknown_provider_404(api):
    assert (await api.post("/api/billing/webhooks/nope", content=b"{}")).status_code == 404


# -- checkout endpoint with a fake provider -------------------------------------------------------------------------

class FakeProvider(PaymentProvider):
    name = "stripe"

    def __init__(self):
        self.calls = []

    def is_configured(self):
        return True

    async def create_checkout_session(self, **kw):
        self.calls.append(kw)
        return CheckoutSession(id="fake_1", url="https://pay.test/fake_1", provider="stripe")

    def verify_webhook(self, payload, headers):
        pass

    def parse_event(self, payload, headers):
        raise NotImplementedError


async def test_checkout_endpoint_uses_provider(api, signup):
    h, uid = await signup("buyer@x.com")
    fake = FakeProvider()
    set_provider("stripe", fake)
    r = await api.post("/api/billing/checkout", json={"plan": "pro"}, headers=h)
    assert r.status_code == 200 and r.json()["url"] == "https://pay.test/fake_1"
    assert fake.calls[0]["scope_id"] == f"user:{uid}" and fake.calls[0]["plan"] == "pro"
    assert (await api.post("/api/billing/checkout", json={"plan": "free"}, headers=h)).status_code == 422


async def test_checkout_503_when_not_configured(api, signup, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY")
    h, _ = await signup("nokey@x.com")
    assert (await api.post("/api/billing/checkout", json={"plan": "pro"}, headers=h)).status_code == 503


async def test_org_checkout_requires_admin(api, signup):
    oh, _ = await signup("bo@x.com")
    org = (await api.post("/api/orgs", json={"name": "O"}, headers=oh)).json()["id"]
    mh, _ = await signup("bm@x.com")
    inv = await api.post(f"/api/orgs/{org}/invites", json={"email": "bm@x.com"}, headers=oh)
    await api.post("/api/orgs/invites/accept", json={"token": inv.json()["invite_url"].split("token=")[1]}, headers=mh)
    set_provider("stripe", FakeProvider())
    assert (await api.post("/api/billing/checkout", json={"plan": "team"}, headers={**mh, "X-Org-Id": org})).status_code == 403
    assert (await api.post("/api/billing/checkout", json={"plan": "team"}, headers={**oh, "X-Org-Id": org})).status_code == 200
    summary = (await api.get("/api/billing/summary", headers={**mh, "X-Org-Id": org})).json()
    assert summary["scope"] == "organization" and summary["can_manage"] is False


# -- plan limit enforcement on request creation -------------------------------------------------------------------------

async def test_free_plan_request_limit_enforced(api, signup):
    h, _ = await signup("limit@x.com")
    for i in range(3):
        r = await api.post("/api/requests", json={"name": f"R{i}", "description": "d"}, headers=h)
        assert r.status_code == 201, r.text
    blocked = await api.post("/api/requests", json={"name": "R4", "description": "d"}, headers=h)
    assert blocked.status_code == 402 and blocked.json()["detail"]["code"] == "request_limit"
    s = (await api.get("/api/billing/summary", headers=h)).json()
    assert s["usage"]["requests_created"] == 3 and s["credits"]["balance"] == 22


async def test_upgrade_lifts_limit(api, signup):
    h, uid = await signup("up@x.com")
    for i in range(3):
        await api.post("/api/requests", json={"name": f"R{i}", "description": "d"}, headers=h)
    await _post_stripe(api, stripe_event("e_up2", "checkout.session.completed",
                                         {"client_reference_id": f"user:{uid}", "subscription": "s", "metadata": {"plan": "pro"}}))
    assert (await api.post("/api/requests", json={"name": "more", "description": "d"}, headers=h)).status_code == 201


async def test_org_workspace_uses_org_quota_and_blocks_viewers(api, signup):
    oh, _ = await signup("qo@x.com")
    vh, _ = await signup("qv@x.com")
    org = (await api.post("/api/orgs", json={"name": "Q"}, headers=oh)).json()["id"]
    inv = await api.post(f"/api/orgs/{org}/invites", json={"email": "qv@x.com", "role": "viewer"}, headers=oh)
    await api.post("/api/orgs/invites/accept", json={"token": inv.json()["invite_url"].split("token=")[1]}, headers=vh)
    ok = await api.post("/api/requests", json={"name": "Team req", "description": "d"}, headers={**oh, "X-Org-Id": org})
    assert ok.status_code == 201
    no = await api.post("/api/requests", json={"name": "x", "description": "d"}, headers={**vh, "X-Org-Id": org})
    assert no.status_code == 403
    assert (await store.usage_this_period(org))["requests_created"] == 1
