"""Credit top-ups through the payment-provider interface, and the two clearly labelled credit balances."""
import httpx
import pytest

from app.billing import store
from app.billing.providers.base import CheckoutSession
from app.billing.providers.registry import reset_providers
from app.billing.providers.stripe import StripeProvider
from app.waterfall import service as waterfall
from tests.growth.test_billing import stripe_event


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("PAYMENT_PROVIDER", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    yield
    reset_providers()


async def test_topup_unavailable_without_a_provider(api, signup):
    h, _ = await signup("t0@x.com")
    opts = (await api.get("/api/billing/topup", headers=h)).json()
    assert opts["providers"] == [] and [p["credits"] for p in opts["packs"]] == [100, 500, 2000]
    r = await api.post("/api/billing/topup", json={"credits": 100}, headers=h)
    assert r.status_code == 503


async def test_mock_provider_credits_request_credits_immediately(api, signup, monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "mock")
    h, uid = await signup("t1@x.com")
    before = (await api.get("/api/billing/summary", headers=h)).json()["credits"]["balance"]
    r = await api.post("/api/billing/topup", json={"credits": 500, "target": "requests"}, headers=h)
    assert r.status_code == 200 and r.json()["settled"] is True
    after = (await api.get("/api/billing/summary", headers=h)).json()
    assert after["credits"]["balance"] == before + 500
    assert after["credits"]["recent"][0]["label"] == "Top-up"
    assert after["credits"]["label"] == "Request credits" and after["enrichment_credits"]["label"] == "Email lookup credits"
    assert await store.credit_balance(f"user:{uid}") == before + 500


async def test_enrichment_topup_goes_to_the_email_lookup_balance_only(api, signup, monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "mock")
    h, uid = await signup("t2@x.com")
    s0 = (await api.get("/api/billing/summary", headers=h)).json()
    r = await api.post("/api/billing/topup", json={"credits": 100, "target": "enrichment"}, headers=h)
    assert r.status_code == 200
    s1 = (await api.get("/api/billing/summary", headers=h)).json()
    assert s1["enrichment_credits"]["balance"] == s0["enrichment_credits"]["balance"] + 100
    assert s1["credits"]["balance"] == s0["credits"]["balance"]
    assert await waterfall.balance(uid) == s1["enrichment_credits"]["balance"]


async def test_invalid_pack_and_target_rejected(api, signup, monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "mock")
    h, _ = await signup("t3@x.com")
    assert (await api.post("/api/billing/topup", json={"credits": 7}, headers=h)).status_code == 422
    assert (await api.post("/api/billing/topup", json={"credits": 100, "target": "nope"}, headers=h)).status_code == 422
    assert (await api.post("/api/billing/topup", json={"credits": 100, "provider": "stripe"}, headers=h)).status_code == 503


async def test_org_topup_needs_admin_and_credits_the_org_ledger(api, signup, monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "mock")
    oh, _ = await signup("t4o@x.com")
    org = (await api.post("/api/orgs", json={"name": "O"}, headers=oh)).json()["id"]
    mh, _ = await signup("t4m@x.com")
    inv = await api.post(f"/api/orgs/{org}/invites", json={"email": "t4m@x.com"}, headers=oh)
    await api.post("/api/orgs/invites/accept", json={"token": inv.json()["invite_url"].split("token=")[1]}, headers=mh)
    assert (await api.post("/api/billing/topup", json={"credits": 100}, headers={**mh, "X-Org-Id": org})).status_code == 403
    assert (await api.post("/api/billing/topup", json={"credits": 100}, headers={**oh, "X-Org-Id": org})).status_code == 200
    assert await store.credit_balance(org) == 100
    opts = (await api.get("/api/billing/topup", headers={**mh, "X-Org-Id": org})).json()
    assert opts["can_manage"] is False


class _Stripe(StripeProvider):
    def __init__(self, handler):
        super().__init__(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_stripe_topup_creates_session_and_webhook_credits_once(api, signup, monkeypatch):
    from app.billing.providers.registry import set_provider

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_fake")
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"id": "cs_1", "url": "https://pay.test/cs_1"})

    set_provider("stripe", _Stripe(handler))
    h, uid = await signup("t5@x.com")
    r = await api.post("/api/billing/topup", json={"credits": 100, "target": "requests"}, headers=h)
    assert r.status_code == 200 and r.json()["settled"] is False and r.json()["url"] == "https://pay.test/cs_1"
    assert "mode=payment" in seen["body"] and "metadata%5Bkind%5D=topup" in seen["body"]
    assert "unit_amount%5D=1000" in seen["body"]
    base = await store.credit_balance(f"user:{uid}")
    assert base == 0  # nothing is credited before payment is confirmed

    from tests.growth.test_billing import stripe_headers

    body = stripe_event("evt_topup", "checkout.session.completed", {
        "payment_status": "paid", "client_reference_id": f"user:{uid}",
        "metadata": {"kind": "topup", "scope_id": f"user:{uid}", "user_id": uid, "credits": "100", "target": "requests"}})
    set_provider("stripe", StripeProvider())  # real parsing/verification, no network needed for webhooks
    first = await api.post("/api/billing/webhooks/stripe", content=body, headers=stripe_headers(body))
    assert first.json() == {"status": "ok", "outcome": "topup_credited"}
    dup = await api.post("/api/billing/webhooks/stripe", content=body, headers=stripe_headers(body))
    assert dup.json() == {"status": "duplicate"}
    assert await store.credit_balance(f"user:{uid}") == 100


async def test_unpaid_topup_session_is_ignored(api, monkeypatch):
    from tests.growth.test_billing import stripe_headers

    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_fake")

    body = stripe_event("evt_unpaid", "checkout.session.completed", {
        "payment_status": "unpaid", "metadata": {"kind": "topup", "scope_id": "user:z", "user_id": "z",
                                                  "credits": "100", "target": "requests"}})
    r = await api.post("/api/billing/webhooks/stripe", content=body, headers=stripe_headers(body))
    assert r.json()["outcome"] == "ignored"
    assert await store.credit_balance("user:z") == 0


async def test_provider_without_topup_support_is_refused(api, signup, monkeypatch):
    from app.billing.providers.registry import set_provider
    from tests.growth.test_billing import FakeProvider

    class NoTopup(FakeProvider):
        supports_topup = False

        async def create_checkout_session(self, **kw):
            return CheckoutSession(id="x", url="u", provider="stripe")

    set_provider("stripe", NoTopup())
    h, _ = await signup("t6@x.com")
    r = await api.post("/api/billing/topup", json={"credits": 100, "provider": "stripe"}, headers=h)
    assert r.status_code == 503
