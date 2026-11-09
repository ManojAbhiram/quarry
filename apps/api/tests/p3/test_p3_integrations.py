import json
from datetime import datetime, timedelta

import pytest

from app.db.models import TABLES
from app.integrations import webhooks
from app.outreach import deps


class FakePoster:
    def __init__(self, statuses=None):
        self.calls: list[tuple[str, bytes, dict]] = []
        self.statuses = list(statuses or [])

    async def post(self, url, body, headers):
        self.calls.append((url, body, headers))
        s = self.statuses.pop(0) if self.statuses else 200
        if isinstance(s, Exception):
            raise s
        return s


@pytest.fixture
def poster(monkeypatch):
    fake = FakePoster()
    monkeypatch.setattr(webhooks.ports, "poster", fake)
    monkeypatch.setattr(webhooks, "check_url", lambda url: None)  # no DNS in tests
    return fake


async def seed(uid, n=3):
    req = await TABLES["requests"].insert({"user_id": uid, "status": "Completed", "created_at": datetime.utcnow()})
    ids = [await TABLES["leads"].insert({"request_id": req, "user_id": uid, "url": f"https://c{i}.test", "title": f"C{i}",
                                         "email": f"x@c{i}.test", "match_score": float(i)}) for i in range(n)]
    return req, ids


# ------------------------------------------------------------------ API keys
async def test_api_key_is_hashed_scoped_and_revocable(api, signup):
    h, uid = await signup()
    req, ids = await seed(uid)
    r = await api.post("/api/integrations/api-keys", headers=h, json={"name": "ci", "scopes": ["read:requests"]})
    assert r.status_code == 201
    key = r.json()["key"]
    assert key.startswith("qk_")
    stored = await TABLES["api_keys"].get(_id=r.json()["_id"])
    assert key not in str(stored) and stored["key_hash"] != key
    listed = (await api.get("/api/integrations/api-keys", headers=h)).json()["keys"][0]
    assert "key" not in listed and "key_hash" not in listed and listed["prefix"] == key[:10]
    kh = {"Authorization": f"Bearer {key}"}
    got = await api.get("/api/public/v1/requests", headers=kh)
    assert got.status_code == 200 and got.json()["total"] == 1 and "user_id" not in got.json()["data"][0]
    # scope enforcement
    assert (await api.get(f"/api/public/v1/requests/{req}/leads", headers=kh)).status_code == 403
    assert (await api.get("/api/public/v1/lists", headers=kh)).status_code == 403
    # no key / garbage key
    assert (await api.get("/api/public/v1/requests")).status_code == 401
    assert (await api.get("/api/public/v1/requests", headers={"X-API-Key": "qk_nope"})).status_code == 401
    # revoke
    assert (await api.delete(f"/api/integrations/api-keys/{r.json()['_id']}", headers=h)).status_code == 204
    assert (await api.get("/api/public/v1/requests", headers=kh)).status_code == 401


async def test_public_api_is_tenant_isolated_and_reads_leads_and_lists(api, signup):
    ha, ua = await signup("a@t.com")
    hb, ub = await signup("b@t.com")
    req, ids = await seed(ua)
    _, other_ids = await seed(ub, 1)
    key = (await api.post("/api/integrations/api-keys", headers=ha, json={})).json()["key"]
    kh = {"X-API-Key": key}
    leads = (await api.get(f"/api/public/v1/requests/{req}/leads?limit=2", headers=kh)).json()
    assert leads["total"] == 3 and len(leads["data"]) == 2 and leads["data"][0]["match_score"] == 2.0
    assert (await api.get(f"/api/public/v1/leads/{ids[0]}", headers=kh)).json()["title"] == "C0"
    assert (await api.get(f"/api/public/v1/leads/{other_ids[0]}", headers=kh)).status_code == 404
    lst = (await api.post("/api/lists", headers=ha, json={"name": "L"})).json()
    await api.post(f"/api/lists/{lst.get('_id') or lst.get('id')}/leads", headers=ha, json={"lead_ids": ids[:2]})
    assert len((await api.get("/api/public/v1/lists", headers=kh)).json()["data"]) == 1
    lid = lst.get("_id") or lst.get("id")
    assert len((await api.get(f"/api/public/v1/lists/{lid}/leads", headers=kh)).json()["data"]) == 2


async def test_invalid_scopes_rejected(api, signup):
    h, _ = await signup()
    assert (await api.post("/api/integrations/api-keys", headers=h, json={"scopes": ["write:all"]})).status_code == 422


# ------------------------------------------------------------------ webhooks
def test_signature_roundtrip_and_tamper():
    body = b'{"a":1}'
    sig = webhooks.sign("whsec_x", 1000, body)
    assert webhooks.verify_signature("whsec_x", sig, body, now=1100)
    assert not webhooks.verify_signature("whsec_x", sig, b'{"a":2}', now=1100)
    assert not webhooks.verify_signature("whsec_y", sig, body, now=1100)
    assert not webhooks.verify_signature("whsec_x", sig, body, now=5000)  # replay window
    assert not webhooks.verify_signature("whsec_x", "garbage", body)


async def test_webhook_created_with_secret_once_and_ssrf_blocked(api, signup, poster):
    h, _ = await signup()
    r = await api.post("/api/integrations/webhooks", headers=h, json={"url": "https://hooks.example.test/in"})
    assert r.status_code == 201 and r.json()["secret"].startswith("whsec_")
    listed = (await api.get("/api/integrations/webhooks", headers=h)).json()["webhooks"][0]
    assert "secret" not in listed and "secret_enc" not in listed
    assert (await api.post("/api/integrations/webhooks", headers=h, json={"url": "ftp://x"})).status_code == 422
    assert (await api.post("/api/integrations/webhooks", headers=h,
                           json={"url": "https://h.test", "events": ["nope"]})).status_code == 422


async def test_ssrf_guard_rejects_private_targets(api, signup):
    h, _ = await signup()
    r = await api.post("/api/integrations/webhooks", headers=h, json={"url": "http://127.0.0.1:8000/admin"})
    assert r.status_code == 422 and "not allowed" in r.text


async def test_delivery_is_signed_and_event_filtered(api, signup, poster):
    h, uid = await signup()
    hook = (await api.post("/api/integrations/webhooks", headers=h,
                           json={"url": "https://hooks.example.test/in", "events": ["outreach.reply"]})).json()
    assert await webhooks.emit(uid, "signal.detected", {"x": 1}) == 0  # not subscribed
    assert await webhooks.emit(uid, "outreach.reply", {"email": "a@b.test"}) == 1
    assert (await webhooks.deliver_pending())["delivered"] == 1
    url, body, headers = poster.calls[0]
    assert webhooks.verify_signature(hook["secret"], headers["X-Quarry-Signature"], body)
    payload = json.loads(body)
    assert payload["event"] == "outreach.reply" and payload["data"] == {"email": "a@b.test"}
    assert headers["X-Quarry-Event"] == "outreach.reply"
    # delivered rows are not re-sent
    assert (await webhooks.deliver_pending())["delivered"] == 0


async def test_failed_deliveries_retry_with_backoff_then_give_up(api, signup, poster):
    h, uid = await signup()
    await api.post("/api/integrations/webhooks", headers=h, json={"url": "https://hooks.example.test/in"})
    poster.statuses = [500, RuntimeError("conn reset"), 502, 503, 500, 500]
    await webhooks.emit(uid, "webhook.test", {})
    t = datetime.utcnow()
    results = []
    for minutes in (0, 2, 10, 60, 300, 1100):
        results.append(await webhooks.deliver_pending(t + timedelta(minutes=minutes)))
    assert [r["retrying"] for r in results] == [1, 1, 1, 1, 1, 0]
    assert results[-1]["failed"] == 1
    d = (await TABLES["webhook_deliveries"].find())[0]
    assert d["status"] == "failed" and d["attempts"] == 6
    # not due yet -> nothing happens on an immediate retry
    assert await webhooks.deliver_pending(t) == {"delivered": 0, "retrying": 0, "failed": 0}


async def test_not_yet_due_retry_is_skipped(api, signup, poster):
    h, uid = await signup()
    await api.post("/api/integrations/webhooks", headers=h, json={"url": "https://hooks.example.test/in"})
    poster.statuses = [500]
    await webhooks.emit(uid, "webhook.test", {})
    now = datetime.utcnow()
    await webhooks.deliver_pending(now)
    assert (await webhooks.deliver_pending(now + timedelta(seconds=30)))["delivered"] == 0
    assert len(poster.calls) == 1


async def test_test_endpoint_and_ownership(api, signup, poster):
    ha, _ = await signup("a@t.com")
    hb, _ = await signup("b@t.com")
    hook = (await api.post("/api/integrations/webhooks", headers=ha, json={"url": "https://hooks.example.test/in"})).json()
    assert (await api.post(f"/api/integrations/webhooks/{hook['_id']}/test", headers=ha)).json()["delivered"] == 1
    assert (await api.post(f"/api/integrations/webhooks/{hook['_id']}/test", headers=hb)).status_code == 404
    assert (await api.delete(f"/api/integrations/webhooks/{hook['_id']}", headers=hb)).status_code == 404
    assert (await api.patch(f"/api/integrations/webhooks/{hook['_id']}", headers=ha, json={"active": False})).json()["active"] is False
    assert (await api.get(f"/api/integrations/webhooks/{hook['_id']}/deliveries", headers=ha)).status_code == 200


async def test_outreach_events_reach_webhooks(api, signup, make_sequence, smtp, imap, poster):
    from app.outreach import service
    from tests.p3.test_p3_outreach_flow import NOW, reply, started

    h, _ = await signup()
    await api.post("/api/integrations/webhooks", headers=h,
                   json={"url": "https://hooks.example.test/in", "events": ["outreach.reply"]})
    box, _, _ = await started(api, h, make_sequence)
    await service.run_due(NOW)
    imap.inbox.append((1, reply(smtp.sent[0]["Message-ID"])))
    await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)
    assert (await webhooks.deliver_pending())["delivered"] == 1


# ------------------------------------------------------------------ export
async def test_csv_export_for_request_and_list_with_ownership(api, signup):
    ha, ua = await signup("a@t.com")
    hb, _ = await signup("b@t.com")
    req, ids = await seed(ua)
    r = await api.post("/api/integrations/export", headers=ha, json={"source": "request", "id": req})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.lstrip("﻿").strip().splitlines()
    assert lines[0] == "title,url,email,phone,match_score,snippet" and len(lines) == 4
    assert (await api.post("/api/integrations/export", headers=hb, json={"source": "request", "id": req})).status_code == 404
    assert (await api.post("/api/integrations/export", headers=ha, json={"source": "list", "id": "nope"})).status_code == 404


async def test_webhook_export_queues_leads_to_chosen_hook(api, signup, poster):
    h, uid = await signup()
    req, _ = await seed(uid)
    hook = (await api.post("/api/integrations/webhooks", headers=h, json={"url": "https://hooks.example.test/in"})).json()
    bad = await api.post("/api/integrations/export", headers=h, json={"source": "request", "id": req, "destination": "webhook"})
    assert bad.status_code == 422
    r = await api.post("/api/integrations/export", headers=h,
                       json={"source": "request", "id": req, "destination": "webhook", "webhook_id": hook["_id"]})
    assert r.json() == {"queued": 1, "leads": 3}
    await webhooks.deliver_pending()
    payload = json.loads(poster.calls[0][1])
    assert payload["event"] == "leads.export" and len(payload["data"]["leads"]) == 3


# ------------------------------------------------------------------ deps adapter
async def test_fallback_suppression_matches_email_and_domain(api, signup):
    _, uid = await signup()
    await deps.add_suppression(uid, "Bad@X.test", "manual", "t")
    await deps.add_suppression(uid, "spam.test", "manual", "t")
    assert await deps.is_suppressed(uid, "bad@x.test")
    assert await deps.is_suppressed(uid, "anyone@spam.test")
    assert not await deps.is_suppressed(uid, "good@x.test")
    assert not await deps.is_suppressed("someone-else", "bad@x.test")


async def test_fallback_jobs_run_due_handlers():
    if deps.HAVE_JOBS:
        pytest.skip("Phase 1 jobs present")
    seen = []
    deps._QUEUE.clear()
    deps.register_handler("t.kind", lambda payload: seen.append(payload))
    await deps.enqueue("t.kind", {"a": 1})
    await deps.enqueue("t.kind", {"later": 1}, run_at=datetime.utcnow() + timedelta(days=1))
    assert await deps.run_local_queue() == 1 and seen == [{"a": 1}]


def test_wiring_registers_every_job_kind():
    from app.p3 import wiring

    wiring.register_handlers()
    if not deps.HAVE_JOBS:
        assert set(wiring.JOB_KINDS) <= set(deps.HANDLERS)
