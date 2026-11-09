"""Fixes from the flow audit: auth bypass, lead ownership, writable status, login messages, rate limiting,
failure reasons, restart recovery, input caps and data erasure."""
import asyncio
from datetime import datetime

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.db import engine, leads
from app.db import lead_lists as ll
from app.db import requests as reqs
from app.db.models import TABLES, LeadListItem


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _signup(api, email):
    body = {"email": email, "name": "T", "password": "Passw0rd!x", "org_name": "Org", "org_domain": email.split("@")[0] + ".test"}
    r = await api.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    j = r.json()
    return {"Authorization": f"Bearer {j['access_token']}"}, j["user"]["id"]


async def _count(table):
    async with engine.read_session() as s, s.begin():
        return (await s.execute(select(func.count()).select_from(table))).scalar_one()


# ── authentication / authorization ───────────────────────────────────────────

async def test_sse_stream_rejects_x_user_id_header_without_a_token(api):
    from app.main import app

    _, uid = await _signup(api, "sse@t.com")
    api.cookies.clear()  # signup also set the session cookie; the header alone must not authenticate
    path = next(p for p in app.openapi()["paths"] if p.endswith("/status/{request_id}/stream"))
    resp = await asyncio.wait_for(api.get(path.replace("{request_id}", "r1"), headers={"X-User-Id": uid}), 5)
    assert resp.status_code == 401


async def test_cannot_add_someone_elses_lead_to_my_list(api):
    ha, uid_a = await _signup(api, "a@t.com")
    hb, _ = await _signup(api, "b@t.com")
    lead_id = await TABLES["leads"].insert({"request_id": "rA", "user_id": uid_a, "url": "https://a.com", "title": "A Corp"})
    lst = (await api.post("/api/lists", headers=hb, json={"name": "Mine"})).json()
    list_id = lst.get("id") or lst.get("_id")
    await api.post(f"/api/lists/{list_id}/leads", headers=hb, json={"lead_ids": [lead_id]})
    detail = (await api.get(f"/api/lists/{list_id}", headers=hb)).json()
    assert detail["leads"] == []


async def test_can_add_my_own_lead_to_my_list(api):
    ha, uid_a = await _signup(api, "own@t.com")
    lead_id = await TABLES["leads"].insert({"request_id": "rA", "user_id": uid_a, "url": "https://a.com", "title": "A Corp"})
    lst = (await api.post("/api/lists", headers=ha, json={"name": "Mine"})).json()
    list_id = lst.get("id") or lst.get("_id")
    await api.post(f"/api/lists/{list_id}/leads", headers=ha, json={"lead_ids": [lead_id]})
    detail = (await api.get(f"/api/lists/{list_id}", headers=ha)).json()
    assert [x["title"] for x in detail["leads"]] == ["A Corp"]


async def test_list_views_and_export_never_show_other_users_leads(api):
    _, uid_a = await _signup(api, "victim@t.com")
    hb, uid_b = await _signup(api, "spy@t.com")
    lead_id = await TABLES["leads"].insert({"request_id": "rA", "user_id": uid_a, "url": "https://secret.com", "title": "Secret Corp"})
    lst = await ll.create_lead_list(uid_b, "Injected")
    async with engine.session() as s, s.begin():  # membership planted directly, bypassing the API check
        s.add(LeadListItem(list_id=lst["_id"], lead_id=lead_id))
    detail = (await api.get(f"/api/lists/{lst['_id']}", headers=hb)).json()
    export = await api.get(f"/api/lists/{lst['_id']}/export?format=csv", headers=hb)
    assert detail["leads"] == []
    assert "Secret Corp" not in export.text


async def test_put_request_ignores_a_client_supplied_status(api):
    h, _ = await _signup(api, "st@t.com")
    rid = (await api.post("/api/requests", headers=h, json={"name": "Campaign"})).json()["id"]
    resp = await api.put(f"/api/requests/{rid}", headers=h, json={"status": "Completed", "title": "Renamed"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "Draft" and resp.json()["title"] == "Renamed"


async def test_login_errors_do_not_reveal_whether_the_email_exists(api):
    await _signup(api, "real@t.com")
    unknown = await api.post("/api/auth/login", json={"email": "nobody@t.com", "password": "whatever1"})
    wrong = await api.post("/api/auth/login", json={"email": "real@t.com", "password": "wrong-pass-1"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


async def test_login_is_rate_limited(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "AUTH_RATE_LIMIT_ATTEMPTS", 3)
    codes = [(await api.post("/api/auth/login", json={"email": "x@t.com", "password": "pw-12345"})).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    blocked = await api.post("/api/auth/login", json={"email": "x@t.com", "password": "pw-12345"})
    assert int(blocked.headers["Retry-After"]) > 0


# ── pipeline visibility and recovery ─────────────────────────────────────────

async def test_failure_reason_is_stored_and_returned(db):
    from app.schemas.requests import request_to_out

    rid = await reqs.insert_complete_lead_request({"title": "t"}, "u1")
    await reqs.update_request_status(rid, "Failed", failure_reason="Serper rejected the API key")
    doc = await reqs.get_request_by_id(rid, "u1")
    assert doc["status"] == "Failed" and doc["failure_reason"] == "Serper rejected the API key"
    assert request_to_out(doc, {}).failure_reason == "Serper rejected the API key"


@pytest.mark.parametrize("code, expected", [(401, "API key"), (403, "API key"), (429, "rate limit")])
async def test_serper_http_errors_become_a_readable_reason(monkeypatch, code, expected):
    from app.services import leads as pipeline

    async def boom(_query):
        req = httpx.Request("POST", "https://google.serper.dev/search")
        raise httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))

    monkeypatch.setattr(pipeline, "fetch_leads_from_serper", boom)
    items, reason = await pipeline._fetch_all_serper_results(["q1", "q2"])
    assert items == [] and "Serper" in reason and expected in reason


async def test_serper_success_has_no_failure_reason(monkeypatch):
    from app.services import leads as pipeline

    async def ok(_query):
        return {"organic": [{"title": "T", "link": "https://t.com", "snippet": "s"}]}

    monkeypatch.setattr(pipeline, "fetch_leads_from_serper", ok)
    items, reason = await pipeline._fetch_all_serper_results(["q"])
    assert len(items) == 1 and reason is None


async def test_orphaned_pending_requests_fail_on_startup(db):
    pending = await reqs.insert_complete_lead_request({"title": "p", "status": "Pending"}, "u1")
    done = await reqs.insert_complete_lead_request({"title": "d", "status": "Completed"}, "u1")
    draft = await reqs.insert_complete_lead_request({"title": "x", "status": "Draft"}, "u1")
    assert await reqs.fail_orphaned_requests() == 1
    got = await reqs.get_request_by_id(pending, "u1")
    assert got["status"] == "Failed" and "restart" in got["failure_reason"].lower()
    assert (await reqs.get_request_by_id(done, "u1"))["status"] == "Completed"
    assert (await reqs.get_request_by_id(draft, "u1"))["status"] == "Draft"


async def test_request_exists(db):
    rid = await reqs.insert_complete_lead_request({"title": "t"}, "u1")
    assert await reqs.request_exists(rid) is True
    await reqs.delete_request_by_id(rid)
    assert await reqs.request_exists(rid) is False


def test_num_leads_is_capped_and_positive():
    from app.schemas.request_intake import RequestIntakeCreate

    for bad in (100000, 0, -5):
        with pytest.raises(ValidationError) as exc:
            RequestIntakeCreate.model_validate({"num_leads": bad})
        assert any(err["loc"] == ("num_leads",) for err in exc.value.errors()), bad


# ── erasure ──────────────────────────────────────────────────────────────────

async def _seed_request(uid, rid_title, url):
    rid = await reqs.insert_complete_lead_request({"title": rid_title}, uid)
    from app.db import icp_profiles, product_intake

    await product_intake.upsert_product_intake(rid, {"product_name": "P"})
    await icp_profiles.upsert_icp_profile(rid, {"firmographic": {}})
    await leads.save_enriched_leads_to_db(rid, uid, [{
        "company_name": rid_title, "source_url": url, "website": url, "match_score": "70/100",
        "decision_makers": [{"name": "Ann", "linkedin_url": f"https://linkedin.com/in/{rid_title}"}],
    }])
    lead_id = (await TABLES["leads"].find())[-1]["_id"]
    return rid, lead_id


async def test_erasing_a_request_removes_its_leads_and_the_people_in_them(db):
    from app.db import erasure

    rid1, lead1 = await _seed_request("u1", "one", "https://one.com")
    rid2, lead2 = await _seed_request("u1", "two", "https://two.com")
    lst = await ll.create_lead_list("u1", "L")
    await ll.add_leads_to_list(lst["_id"], "u1", [lead1, lead2])

    assert await erasure.erase_request(rid1) is True

    assert await reqs.request_exists(rid1) is False
    assert await TABLES["leads"].get(_id=lead1) is None
    assert await TABLES["decision_makers"].find() and len(await TABLES["decision_makers"].find()) == 1
    assert await TABLES["lead_enrichments"].get(lead_id=lead1) is None
    assert await TABLES["product_intake"].get(request_id=rid1) is None
    assert await TABLES["icp_profiles"].get(request_id=rid1) is None
    assert (await ll.get_lead_list_by_id(lst["_id"], "u1"))["lead_ids"] == [lead2]
    assert await TABLES["leads"].get(_id=lead2) is not None  # the other request is untouched
    assert await erasure.erase_request(rid1) is False


async def test_erasing_an_account_removes_everything_it_owns_and_nothing_else(db):
    from app.db import erasure, user_sessions, users

    uid_a, _ = await users.insert_user({"email": "a@t.com", "org_id": None})
    uid_b, _ = await users.insert_user({"email": "b@t.com", "org_id": None})
    await _seed_request(uid_a, "mine", "https://mine.com")
    keep_rid, keep_lead = await _seed_request(uid_b, "theirs", "https://theirs.com")
    await ll.create_lead_list(uid_a, "mine")
    keep_list = await ll.create_lead_list(uid_b, "theirs")
    await user_sessions.create_session(uid_a, "ha", datetime(2099, 1, 1))

    await erasure.erase_user_data(uid_a)

    assert await users.get_user_by_id(uid_a) is None
    assert await reqs.list_user_requests(uid_a) == []
    assert await ll.get_lead_lists_for_user(uid_a) == []
    assert await TABLES["user_sessions"].get(token_hash="ha") is None
    assert [row["title"] for row in await TABLES["leads"].find()] == ["theirs"]
    assert len(await TABLES["decision_makers"].find()) == 1
    assert await users.get_user_by_id(uid_b) is not None
    assert await reqs.request_exists(keep_rid) and await ll.get_lead_list_by_id(keep_list["_id"], uid_b)


async def test_api_deletes_cascade(api):
    h, uid = await _signup(api, "gone@t.com")
    rid = (await api.post("/api/requests", headers=h, json={"name": "C"})).json()["id"]
    await TABLES["leads"].insert({"request_id": rid, "user_id": uid, "url": "https://x.com", "title": "X", "enrichment_status": "enriched"})
    assert (await api.delete(f"/api/requests/{rid}", headers=h)).status_code == 204
    assert await TABLES["leads"].find() == []

    rid2 = (await api.post("/api/requests", headers=h, json={"name": "C2"})).json()["id"]
    await TABLES["leads"].insert({"request_id": rid2, "user_id": uid, "url": "https://y.com", "title": "Y"})
    assert (await api.delete("/api/users/me", headers=h)).status_code == 204
    assert await TABLES["leads"].find() == [] and await TABLES["users"].get(_id=uid) is None
