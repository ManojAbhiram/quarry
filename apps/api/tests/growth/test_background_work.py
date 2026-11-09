"""Atomic request quota and HubSpot pushes as background jobs."""
import asyncio

import pytest

from app import jobs
from app.billing import store
from app.billing.store import QuotaExceeded, consume_request_quota
from app.crm import jobs as crm_jobs
from app.crm import service
from app.db.models import TABLES
from tests.growth.test_crm import FakeCrm, _setup


# -- atomic quota ----------------------------------------------------------------------------------------------------

async def _race(scope: str, n: int):
    results = await asyncio.gather(*[consume_request_quota(scope) for _ in range(n)], return_exceptions=True)
    ok = [r for r in results if not isinstance(r, Exception)]
    refused = [r for r in results if isinstance(r, QuotaExceeded)]
    assert len(ok) + len(refused) == n, results  # nothing else may go wrong
    return ok, refused


async def test_concurrent_requests_cannot_overshoot_the_monthly_limit(db):
    ok, refused = await _race("user:race1", 12)  # free plan allows 3 requests per month
    assert len(ok) == 3 and len(refused) == 9
    assert {r.code for r in refused} == {"request_limit"}
    assert (await store.usage_this_period("user:race1"))["requests_created"] == 3
    assert await store.credit_balance("user:race1") == 22  # 25 granted - 3 debited, never negative


async def test_concurrent_requests_cannot_overspend_credits(db):
    await store.ensure_period_grant("user:race2", await store.get_plan_for_scope("user:race2"))
    await store.debit_credits("user:race2", 23, "adjustment")  # leaves 2 credits, plan limit is 3
    ok, refused = await _race("user:race2", 8)
    assert len(ok) == 2 and {r.code for r in refused} == {"insufficient_credits"}
    assert await store.credit_balance("user:race2") == 0


async def test_concurrent_http_creates_respect_the_limit(db, monkeypatch):
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
        r = await api.post("/api/auth/register", json={"email": "race@x.com", "name": "Race", "password": "Passw0rd!x",
                                                       "org_name": "O", "org_domain": "race.test"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        codes = await asyncio.gather(*[
            api.post("/api/requests", json={"name": f"R{i}", "description": "d"}, headers=h) for i in range(8)
        ])
    statuses = sorted(c.status_code for c in codes)
    assert statuses.count(201) == 3 and statuses.count(402) == 5


# -- HubSpot push as a background job ---------------------------------------------------------------------------------

class ObservingCrm(FakeCrm):
    def __init__(self, conn_id_getter, **kw):
        super().__init__(**kw)
        self.calls = 0
        self.seen_statuses: list[set] = []
        self._conn_id = conn_id_getter

    async def upsert_company(self, props):
        self.calls += 1
        rows = await service.sync_rows(await self._conn_id())
        self.seen_statuses.append({r["status"] for r in rows.values()})
        return await super().upsert_company(props)


@pytest.fixture(autouse=True)
def _handlers():
    crm_jobs.register_handlers()


async def test_push_returns_immediately_and_runs_in_the_background(api, signup, monkeypatch):
    h, uid, lst, lead_ids = await _setup(api, signup, "bg1@x.com")
    conn = await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None,
                                         auth_type="private_app", info={})

    async def conn_id():
        return conn["_id"]

    fake = ObservingCrm(conn_id)
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda c: fake)

    r = await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued" and body["total"] == 4 and fake.calls == 0  # nothing ran inside the request

    st = (await api.get(f"/api/integrations/hubspot/sync?list_id={lst}", headers=h)).json()
    assert st["counts"]["in_progress"] == 4 and {x["status"] for x in st["leads"]} == {"queued"}
    job = (await api.get(f"/api/jobs/{body['job_id']}", headers=h)).json()
    assert job["status"] == "queued" and job["kind"] == "crm.push"

    await jobs.run_pending_once()
    job = (await api.get(f"/api/jobs/{body['job_id']}", headers=h)).json()
    assert job["status"] == "succeeded" and job["result"]["summary"] == {"synced": 3, "failed": 1, "skipped": 0}
    st = (await api.get(f"/api/integrations/hubspot/sync?list_id={lst}", headers=h)).json()
    assert st["counts"] == {"synced": 3, "failed": 1, "not_synced": 0, "in_progress": 0}
    # While the job ran, individual leads were reported as syncing / still queued, not all-or-nothing.
    assert any("syncing" in s for s in fake.seen_statuses) and any("queued" in s for s in fake.seen_statuses)


async def test_second_push_of_the_same_list_joins_the_active_job(api, signup, monkeypatch):
    h, uid, lst, _ = await _setup(api, signup, "bg2@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", lambda c: FakeCrm())
    first = (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)).json()
    second = (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)).json()
    assert second["job_id"] == first["job_id"] and second["joined"] is True
    assert len(await jobs.active_jobs("crm.push")) == 1


async def test_job_that_crashes_marks_leads_failed_and_retryable(api, signup, monkeypatch):
    h, uid, lst, _ = await _setup(api, signup, "bg3@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})

    def boom(c):
        raise RuntimeError("no connector")

    monkeypatch.setitem(service.CONNECTOR_FACTORIES, "hubspot", boom)
    r = (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)).json()
    await jobs.run_pending_once()
    job = (await api.get(f"/api/jobs/{r['job_id']}", headers=h)).json()
    assert job["status"] == "failed" and "did not finish" in job["error"]
    st = (await api.get(f"/api/integrations/hubspot/sync?list_id={lst}", headers=h)).json()
    assert st["counts"]["in_progress"] == 0 and st["counts"]["failed"] == 4
    assert all(x["retryable"] for x in st["leads"])


async def test_deleted_connection_fails_the_job_cleanly(api, signup, monkeypatch):
    h, uid, lst, _ = await _setup(api, signup, "bg4@x.com")
    conn = await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None,
                                         auth_type="private_app", info={})
    r = (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)).json()
    await TABLES["crm_connections"].delete(conn["_id"])
    await jobs.run_pending_once()
    job = (await api.get(f"/api/jobs/{r['job_id']}", headers=h)).json()
    assert job["status"] == "failed" and "no longer exists" in job["error"]


async def test_job_status_is_private_to_the_owner(api, signup, monkeypatch):
    h, uid, lst, _ = await _setup(api, signup, "bg5@x.com")
    await service.save_connection(f"user:{uid}", "hubspot", access_token="t", refresh_token=None, auth_type="private_app", info={})
    other, _ = await signup("bg5other@x.com")
    r = (await api.post("/api/integrations/hubspot/push", json={"list_id": lst}, headers=h)).json()
    assert (await api.get(f"/api/jobs/{r['job_id']}", headers=other)).status_code == 404
