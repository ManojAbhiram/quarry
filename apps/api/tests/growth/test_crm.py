import json

import httpx
import pytest

from app.billing.store import upsert_subscription
from app.crm import hooks, service
from app.crm.base import CrmConnector, CrmError, UpsertResult
from app.crm.hubspot import HubSpotConnector
from app.crm.mapping import DEFAULT_MAPPING, MappingError, build_company, build_contacts, validate_mapping
from app.db.models import TABLES


async def _no_sleep(_):
    return None


def hubspot(handler, **kw):
    return HubSpotConnector("tok", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), sleep=_no_sleep, **kw)


# -- mapping --------------------------------------------------------------------------------------------------------

def test_mapping_validation():
    ok = validate_mapping({"company": {"match_score": "quarry_score"}, "contact": {}})
    assert ok["company"]["match_score"] == "quarry_score" and ok["company"]["domain"] == "domain"
    assert ok["contact"]["email"] == "email"
    for bad in ({"company": {"nope": "x"}}, {"company": {"name": "Bad Name!"}}, {"company": {"domain": "website"}},
                {"contact": {"email": "mail"}}):
        with pytest.raises(MappingError):
            validate_mapping(bad)


def test_build_company_and_contacts_dedupe_emails():
    lead = {"title": "Acme", "url": "https://www.acme.com/about", "email": "Hi@acme.com", "snippet": "hiring SDRs"}
    assert build_company(lead, DEFAULT_MAPPING) == {"name": "Acme", "domain": "acme.com", "description": "hiring SDRs"}
    dms = [{"name": "Jane Q Doe", "title": "VP Sales", "email": "hi@acme.com"}, {"name": "Bob", "email": "bob@acme.com"},
           {"name": "NoMail", "email": ""}]
    contacts = build_contacts(lead, dms, DEFAULT_MAPPING)
    assert [c["email"] for c in contacts] == ["hi@acme.com", "bob@acme.com"]
    assert build_company({"title": "x", "url": ""}, DEFAULT_MAPPING) is None


# -- HubSpot connector (HTTP mocked) -------------------------------------------------------------------------------

async def test_hubspot_creates_company_when_not_found_and_updates_when_found():
    calls = []

    def handler(req: httpx.Request):
        body = json.loads(req.content) if req.content else None
        calls.append((req.method, req.url.path))
        assert req.headers["authorization"] == "Bearer tok"
        if req.url.path.endswith("/search"):
            found = body["filterGroups"][0]["filters"][0]["value"] == "exists.com"
            return httpx.Response(200, json={"results": [{"id": "77"}] if found else []})
        if req.method == "POST":
            return httpx.Response(201, json={"id": "100"})
        return httpx.Response(200, json={})

    c = hubspot(handler)
    new = await c.upsert_company({"domain": "new.com", "name": "New"})
    old = await c.upsert_company({"domain": "exists.com", "name": "Old"})
    assert (new.id, new.created) == ("100", True) and (old.id, old.created) == ("77", False)
    assert ("PATCH", "/crm/v3/objects/companies/77") in calls and ("POST", "/crm/v3/objects/companies") in calls


async def test_hubspot_contact_associates_company():
    seen = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.url.path.endswith("/search"):
            return httpx.Response(200, json={"results": []})
        return httpx.Response(201, json={"id": "c1"}) if req.method == "POST" else httpx.Response(200, json={})

    await hubspot(handler).upsert_contact({"email": "a@b.com"}, company_id="9")
    assert ("PUT", "/crm/v4/objects/contacts/c1/associations/default/companies/9") in seen


async def test_hubspot_retries_429_and_5xx_then_succeeds():
    n = {"i": 0}

    def handler(req):
        n["i"] += 1
        if n["i"] == 1:
            return httpx.Response(429, headers={"retry-after": "1"})
        if n["i"] == 2:
            return httpx.Response(503)
        return httpx.Response(200, json={"portalId": 42, "accountType": "STANDARD"})

    info = await hubspot(handler).test_connection()
    assert info["portal_id"] == 42 and n["i"] == 3


async def test_hubspot_gives_up_with_retryable_error():
    c = hubspot(lambda req: httpx.Response(500), max_attempts=3)
    with pytest.raises(CrmError) as e:
        await c.test_connection()
    assert e.value.retryable is True


async def test_hubspot_client_error_is_not_retried():
    n = {"i": 0}

    def handler(req):
        n["i"] += 1
        return httpx.Response(400, json={"message": "Property foo does not exist"})

    with pytest.raises(CrmError) as e:
        await hubspot(handler).upsert_company({"domain": "a.com"})
    assert n["i"] == 1 and not e.value.retryable and "foo" in e.value.message  # 4xx fails fast, no retry


async def test_hubspot_oauth_refreshes_on_401():
    tokens = []

    async def persist(a, r):
        tokens.append((a, r))

    def handler(req):
        if req.url.path == "/oauth/v1/token":
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "r2"})
        if req.headers["authorization"] == "Bearer tok":
            return httpx.Response(401)
        return httpx.Response(200, json={"portalId": 1})

    c = hubspot(handler, refresh_token="r1", client_id="cid", client_secret="sec", on_token_refresh=persist)
    assert (await c.test_connection())["portal_id"] == 1
    assert tokens == [("new", "r2")]


async def test_hubspot_rejected_credentials():
    with pytest.raises(CrmError) as e:
        await hubspot(lambda req: httpx.Response(401)).test_connection()
    assert e.value.status == 401


async def test_hubspot_conflict_on_create_falls_back_to_update():
    state = {"searches": 0}

    def handler(req):
        if req.url.path.endswith("/search"):
            state["searches"] += 1
            return httpx.Response(200, json={"results": [] if state["searches"] == 1 else [{"id": "5"}]})
        if req.method == "POST":
            return httpx.Response(409, json={"message": "exists"})
        return httpx.Response(200, json={})

    r = await hubspot(handler).upsert_company({"domain": "race.com"})
    assert (r.id, r.created) == ("5", False)


# -- push workflow with a fake connector ---------------------------------------------------------------------------------

class FakeCrm(CrmConnector):
    provider = "hubspot"

    def __init__(self, fail_domains=()):
        self.companies, self.contacts, self.fail_domains = {}, {}, set(fail_domains)

    async def test_connection(self):
        return {"portal_id": 1}

    async def upsert_company(self, props):
        d = props["domain"]
        if d in self.fail_domains:
            raise CrmError("boom", retryable=True)
        created = d not in self.companies
        self.companies.setdefault(d, f"co-{len(self.companies)}")
        return UpsertResult(self.companies[d], created)

    async def upsert_contact(self, props, company_id=None):
        created = props["email"] not in self.contacts
        self.contacts.setdefault(props["email"], f"ct-{len(self.contacts)}")
        return UpsertResult(self.contacts[props["email"]], created)


async def _setup(api, signup, email, plan="pro"):
    h, uid = await signup(email)
    await upsert_subscription(f"user:{uid}", {"plan": plan, "status": "active"})
    lead_ids = []
    for i, (title, url, mail) in enumerate([("A", "https://a.com", "x@a.com"), ("A2", "https://www.a.com/p2", "y@a.com"),
                                             ("B", "https://b.com", None), ("NoSite", "", None)]):
        lead_ids.append(await TABLES["leads"].insert(
            {"request_id": "r", "user_id": uid, "url": url or f"none-{i}", "title": title, "email": mail}))
    # the "NoSite" lead has an unusable url
    await TABLES["leads"].update(lead_ids[3], {"url": ""})
    lst = (await api.post("/api/lists", json={"name": "L"}, headers=h)).json()["_id"]
    await api.post(f"/api/lists/{lst}/leads", json={"lead_ids": lead_ids}, headers=h)
    return h, uid, lst, lead_ids


async def test_connect_with_token_stores_encrypted_and_never_returns_it(api, signup, monkeypatch):
    h, uid = await signup("crm1@x.com")
    await upsert_subscription(f"user:{uid}", {"plan": "pro", "status": "active"})

    async def ok(self):
        return {"portal_id": 99}

    monkeypatch.setattr(HubSpotConnector, "test_connection", ok)
    r = await api.put("/api/integrations/hubspot/token", json={"access_token": "pat-secret-token-123"}, headers=h)
    assert r.status_code == 200 and r.json()["connected"] and "pat-secret" not in r.text
    conn = await service.get_connection(f"user:{uid}", "hubspot")
    assert "pat-secret" not in json.dumps(conn, default=str)
    assert "pat-secret" not in (await api.get("/api/integrations", headers=h)).text


async def test_connect_requires_plan_and_valid_token(api, signup, monkeypatch):
    h, uid = await signup("crm2@x.com")  # free plan: 0 CRM connections
    assert (await api.put("/api/integrations/hubspot/token", json={"access_token": "abcdefghij"}, headers=h)).status_code == 402
    await upsert_subscription(f"user:{uid}", {"plan": "pro", "status": "active"})

    async def bad(self):
        raise CrmError("rejected", status=401)

    monkeypatch.setattr(HubSpotConnector, "test_connection", bad)
    assert (await api.put("/api/integrations/hubspot/token", json={"access_token": "abcdefghij"}, headers=h)).status_code == 400


async def _push(api, headers, body):
    """Enqueue a push (HTTP returns at once), run the queued job, and return its summary."""
    from app import jobs
    from app.crm import jobs as crm_jobs

    crm_jobs.register_handlers()
    r = await api.post("/api/integrations/hubspot/push", json=body, headers=headers)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued" and r.json()["job_id"]
    await jobs.run_pending_once()
    job = (await api.get(f"/api/jobs/{r.json()['job_id']}", headers=headers)).json()
    assert job["status"] == "succeeded", job
    return job["result"]


async def test_push_list_syncs_dedupes_by_domain_and_reports_status(api, signup, monkeypatch):
    h, uid, lst, lead_ids = await _setup(api, signup, "crm3@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    fake = FakeCrm()
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda conn: fake)

    r = await _push(api, h, {"list_id": lst})
    assert r["summary"] == {"synced": 3, "failed": 1, "skipped": 0}
    assert sorted(fake.companies) == ["a.com", "b.com"]  # a.com and www.a.com collapsed into one company
    assert set(fake.contacts) == {"x@a.com", "y@a.com"}

    st = (await api.get(f"/api/integrations/hubspot/sync?list_id={lst}", headers=h)).json()
    assert st["counts"] == {"synced": 3, "failed": 1, "not_synced": 0, "in_progress": 0}
    failed = [x for x in st["leads"] if x["status"] == "failed"][0]
    assert "no website domain" in failed["error"]

    again = await _push(api, h, {"list_id": lst, "only_failed": True})
    assert again["summary"] == {"synced": 0, "failed": 1, "skipped": 3}


async def test_failed_lead_is_recorded_and_retried_later(api, signup, monkeypatch):
    h, uid, lst, _ = await _setup(api, signup, "crm4@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    fake = FakeCrm(fail_domains={"b.com"})
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda conn: fake)
    first = await _push(api, h, {"list_id": lst})
    assert first["summary"]["synced"] == 2 and first["summary"]["failed"] == 2  # b.com + the site-less lead
    st = (await api.get(f"/api/integrations/hubspot/sync?list_id={lst}", headers=h)).json()
    assert any(x["error"] == "boom" and x["retryable"] for x in st["leads"])
    fake.fail_domains.clear()
    second = await _push(api, h, {"list_id": lst, "only_failed": True})
    assert second["summary"]["synced"] == 1
    rows = await service.sync_rows((await service.get_connection(f"user:{uid}", "hubspot"))["_id"])
    assert max(r["attempts"] for r in rows.values()) == 2


async def test_cannot_push_someone_elses_list_or_use_their_connection(api, signup, monkeypatch):
    h1, uid1, lst1, _ = await _setup(api, signup, "crm5@x.com")
    h2, uid2 = await signup("crm6@x.com")
    await upsert_subscription(f"user:{uid2}", {"plan": "pro", "status": "active"})
    await service.save_connection(f"user:{uid2}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda conn: FakeCrm())
    assert (await api.post("/api/integrations/hubspot/push", json={"list_id": lst1}, headers=h2)).status_code == 404
    # user 1 never connected HubSpot, so pushing is refused even for their own list
    assert (await api.post("/api/integrations/hubspot/push", json={"list_id": lst1}, headers=h1)).status_code == 404


async def test_mapping_endpoints(api, signup):
    h, uid, _, _ = await _setup(api, signup, "crm7@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    got = (await api.get("/api/integrations/hubspot/mapping", headers=h)).json()
    assert got["mapping"]["company"]["name"] == "name"
    put = await api.put("/api/integrations/hubspot/mapping", json={"company": {"match_score": "quarry_score"}}, headers=h)
    assert put.json()["mapping"]["company"]["match_score"] == "quarry_score"
    assert (await api.put("/api/integrations/hubspot/mapping", json={"company": {"zzz": "a"}}, headers=h)).status_code == 422


async def test_org_viewer_cannot_push_and_org_data_is_isolated(api, signup, monkeypatch):
    oh, ouid = await signup("crmo@x.com")
    org = (await api.post("/api/orgs", json={"name": "O"}, headers=oh)).json()["id"]
    await upsert_subscription(org, {"plan": "team", "status": "active"})
    await service.save_connection(org, "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    vh, _ = await signup("crmv@x.com")
    inv = await api.post(f"/api/orgs/{org}/invites", json={"email": "crmv@x.com", "role": "viewer"}, headers=oh)
    await api.post("/api/orgs/invites/accept", json={"token": inv.json()["invite_url"].split("token=")[1]}, headers=vh)
    lst = (await api.post("/api/lists", json={"name": "L"}, headers=oh)).json()["_id"]
    await api.post(f"/api/orgs/{org}/shares", json={"resource_type": "list", "resource_id": lst}, headers=oh)
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda conn: FakeCrm())
    ws = {"X-Org-Id": org}
    assert (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers={**vh, **ws})).status_code == 403
    assert (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers={**oh, **ws})).status_code == 202
    assert (await api.get("/api/integrations/hubspot/mapping", headers={**vh, **ws})).status_code == 200  # viewers may look
    assert (await api.put("/api/integrations/hubspot/mapping", json={}, headers={**vh, **ws})).status_code == 403
    # a stranger cannot reach the org's integrations at all
    sh, _ = await signup("stranger@x.com")
    assert (await api.get("/api/integrations", headers={**sh, **ws})).status_code == 403


async def test_oauth_url_requires_config(api, signup, monkeypatch):
    h, _ = await signup("oauth@x.com")
    monkeypatch.delenv("HUBSPOT_CLIENT_ID", raising=False)
    assert (await api.get("/api/integrations/hubspot/oauth/url", headers=h)).status_code == 503
    monkeypatch.setenv("HUBSPOT_CLIENT_ID", "cid")
    url = (await api.get("/api/integrations/hubspot/oauth/url", headers=h)).json()["url"]
    assert url.startswith("https://app.hubspot.com/oauth/authorize?") and "client_id=cid" in url


# -- REST hooks ---------------------------------------------------------------------------------------------------------

@pytest.fixture
def allow_urls(monkeypatch):
    monkeypatch.setattr("app.api.integrations.check_url", lambda url: None)


async def test_hook_subscribe_list_unsubscribe_and_ssrf_guard(api, signup, allow_urls, monkeypatch):
    h, _ = await signup("hook1@x.com")
    r = await api.post("/api/hooks/subscribe", json={"event": "lead.created", "target_url": "https://hooks.zapier.test/abc"}, headers=h)
    assert r.status_code == 201 and r.json()["secret"]
    hid = r.json()["id"]
    listed = (await api.get("/api/hooks", headers=h)).json()["hooks"]
    assert listed[0]["id"] == hid and "secret" not in listed[0]
    assert (await api.delete(f"/api/hooks/{hid}", headers=h)).status_code == 204
    assert (await api.delete(f"/api/hooks/{hid}", headers=h)).status_code == 404
    assert (await api.get("/api/hooks/sample/lead.created", headers=h)).json()[0]["event"] == "lead.created"
    assert (await api.post("/api/hooks/subscribe", json={"event": "nope", "target_url": "https://x.test/a"}, headers=h)).status_code == 422
    monkeypatch.undo()  # real SSRF guard back in place
    bad = await api.post("/api/hooks/subscribe", json={"event": "lead.created", "target_url": "http://127.0.0.1:9/x"}, headers=h)
    assert bad.status_code == 422


async def test_event_delivery_is_signed_and_only_to_owner_scope(api, signup, allow_urls):
    h, uid = await signup("hook2@x.com")
    _, other = await signup("hook3@x.com")
    mine = await hooks.subscribe(f"user:{uid}", "list.updated", "https://hooks.test/mine", uid)
    await hooks.subscribe(f"user:{other}", "list.updated", "https://hooks.test/theirs", other)
    seen = []

    def handler(req: httpx.Request):
        seen.append((str(req.url), req.content, req.headers["x-quarry-signature"]))
        return httpx.Response(200)

    real = hooks.deliver

    async def deliver(hook, payload, client=None):
        return await real(hook, payload, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    hooks.deliver = deliver
    try:
        n = await hooks.emit_event(uid, "list.updated", {"list": {"id": "l1"}})
    finally:
        hooks.deliver = real
    assert n == 1 and [s[0] for s in seen] == ["https://hooks.test/mine"]
    assert seen[0][2] == hooks.sign(mine["secret"], seen[0][1])
    assert json.loads(seen[0][1])["event"] == "list.updated"


async def test_failing_hook_is_disabled_after_repeated_failures(api, signup, monkeypatch):
    _, uid = await signup("hook4@x.com")
    hook = await hooks.subscribe(f"user:{uid}", "lead.created", "https://hooks.test/down", uid)

    async def fail(h, p, client=None):
        return False

    monkeypatch.setattr(hooks, "deliver", fail)
    for _ in range(hooks.MAX_CONSECUTIVE_FAILURES):
        await hooks.emit_event(uid, "lead.created", {})
    assert (await TABLES["webhook_subscriptions"].get(_id=hook["_id"]))["active"] is False
    assert await hooks.emit_event(uid, "lead.created", {}) == 0


async def test_adding_leads_to_list_emits_list_updated(api, signup, monkeypatch):
    h, uid = await signup("hook5@x.com")
    await hooks.subscribe(f"user:{uid}", "list.updated", "https://hooks.test/l", uid)
    got = []

    async def capture(hook, payload, client=None):
        got.append(payload)
        return True

    monkeypatch.setattr(hooks, "deliver", capture)
    lid = await TABLES["leads"].insert({"request_id": "r", "user_id": uid, "url": "https://z.com", "title": "Z"})
    lst = (await api.post("/api/lists", json={"name": "L"}, headers=h)).json()["_id"]
    await api.post(f"/api/lists/{lst}/leads", json={"lead_ids": [lid]}, headers=h)
    await hooks.drain()
    assert got and got[0]["event"] == "list.updated" and got[0]["list"]["lead_count"] == 1


async def test_oauth_callback_checks_state_and_exchanges_code(api, signup, monkeypatch):
    h, uid = await signup("oauth2@x.com")
    await upsert_subscription(f"user:{uid}", {"plan": "pro", "status": "active"})
    monkeypatch.setenv("HUBSPOT_CLIENT_ID", "cid")
    monkeypatch.setenv("HUBSPOT_CLIENT_SECRET", "sec")
    url = (await api.get("/api/integrations/hubspot/oauth/url", headers=h)).json()
    forged = await api.post("/api/integrations/hubspot/oauth/callback", json={"code": "abc", "state": "x.y"}, headers=h)
    assert forged.status_code == 400

    real_client = httpx.AsyncClient

    def handler(req: httpx.Request):
        return httpx.Response(200, json={"access_token": "access-secret-AT1", "refresh_token": "refresh-secret-RT1"})

    monkeypatch.setattr("app.api.integrations.httpx.AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler)))

    async def ok(self):
        return {"portal_id": 5}

    monkeypatch.setattr(HubSpotConnector, "test_connection", ok)
    r = await api.post("/api/integrations/hubspot/oauth/callback", json={"code": "abc", "state": url["state"]}, headers=h)
    assert r.status_code == 200 and r.json()["auth_type"] == "oauth"
    conn = await service.get_connection(f"user:{uid}", "hubspot")
    assert conn["refresh_enc"] and "refresh-secret-RT1" not in conn["refresh_enc"]
