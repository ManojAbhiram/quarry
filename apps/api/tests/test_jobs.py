"""Durable job queue: enqueue, retry/backoff, cancel, restart recovery, ownership-scoped API."""
import asyncio
from datetime import datetime, timedelta

import httpx
import pytest

from app import jobs
from app.db.models import TABLES


@pytest.fixture(autouse=True)
def _clean_handlers():
    saved = dict(jobs._handlers)
    jobs._handlers.clear()
    jobs._cancel_requested.clear()
    yield
    jobs._handlers.clear()
    jobs._handlers.update(saved)


async def test_enqueue_and_run_success(db):
    seen = []

    async def handler(payload):
        seen.append((payload, jobs.current_job_id.get()))
        return {"ok": True}

    jobs.register_handler("t.ok", handler)
    job_id = await jobs.enqueue("t.ok", {"a": 1}, owner_id="u1")
    assert (await jobs.get_job(job_id))["status"] == jobs.QUEUED

    assert await jobs.run_pending_once() == 1
    job = await jobs.get_job(job_id)
    assert job["status"] == jobs.SUCCEEDED
    assert job["result"] == {"ok": True}
    assert job["attempts"] == 1
    assert seen == [({"a": 1}, job_id)]


async def test_future_run_at_is_not_picked_up(db):
    async def handler(payload):
        return None

    jobs.register_handler("t.later", handler)
    job_id = await jobs.enqueue("t.later", {}, run_at=datetime.utcnow() + timedelta(hours=1))
    assert await jobs.run_pending_once() == 0
    assert (await jobs.get_job(job_id))["status"] == jobs.QUEUED


async def test_failure_retries_with_backoff_then_fails(db, monkeypatch):
    monkeypatch.setattr(jobs, "BACKOFF_BASE_SECONDS", 0)
    calls = {"n": 0}

    async def handler(payload):
        calls["n"] += 1
        raise RuntimeError("boom")

    jobs.register_handler("t.flaky", handler)
    job_id = await jobs.enqueue("t.flaky", {}, max_attempts=3)
    for _ in range(5):
        await jobs.run_pending_once()
    job = await jobs.get_job(job_id)
    assert calls["n"] == 3
    assert job["status"] == jobs.FAILED
    assert "boom" in job["error"]


async def test_retry_is_scheduled_in_the_future(db, monkeypatch):
    monkeypatch.setattr(jobs, "BACKOFF_BASE_SECONDS", 60)

    async def handler(payload):
        raise RuntimeError("nope")

    jobs.register_handler("t.backoff", handler)
    job_id = await jobs.enqueue("t.backoff", {}, max_attempts=2)
    await jobs.run_pending_once()
    job = await jobs.get_job(job_id)
    assert job["status"] == jobs.QUEUED
    assert job["run_at"] > datetime.utcnow() + timedelta(seconds=30)
    assert await jobs.run_pending_once() == 0  # not due yet


def test_backoff_grows_and_is_capped(monkeypatch):
    monkeypatch.setattr(jobs, "BACKOFF_BASE_SECONDS", 5)
    monkeypatch.setattr(jobs, "BACKOFF_MAX_SECONDS", 40)
    assert [jobs.backoff_seconds(n) for n in (1, 2, 3, 4, 5)] == [5, 10, 20, 40, 40]


async def test_permanent_error_does_not_retry(db):
    calls = {"n": 0}

    async def handler(payload):
        calls["n"] += 1
        raise jobs.PermanentJobError("bad input")

    jobs.register_handler("t.perm", handler)
    job_id = await jobs.enqueue("t.perm", {}, max_attempts=5)
    await jobs.run_pending_once()
    job = await jobs.get_job(job_id)
    assert (job["status"], calls["n"], job["error"]) == (jobs.FAILED, 1, "bad input")


async def test_unknown_kind_fails(db):
    job_id = await jobs.enqueue("t.unregistered", {})
    await jobs.run_pending_once()
    job = await jobs.get_job(job_id)
    assert job["status"] == jobs.FAILED and "No handler" in job["error"]


async def test_cancel_queued_job(db):
    job_id = await jobs.enqueue("t.x", {}, owner_id="u1")
    assert (await jobs.cancel_job(job_id, owner_id="u1"))["status"] == jobs.CANCELLED
    assert await jobs.run_pending_once() == 0
    # cancelling again is a no-op that returns the finished job
    assert (await jobs.cancel_job(job_id, owner_id="u1"))["status"] == jobs.CANCELLED


async def test_cancel_is_owner_scoped(db):
    job_id = await jobs.enqueue("t.x", {}, owner_id="u1")
    assert await jobs.cancel_job(job_id, owner_id="someone-else") is None
    assert (await jobs.get_job(job_id))["status"] == jobs.QUEUED


async def test_cancel_running_job(db):
    started = asyncio.Event()

    async def handler(payload):
        started.set()
        await asyncio.sleep(30)

    jobs.register_handler("t.long", handler)
    job_id = await jobs.enqueue("t.long", {}, owner_id="u1")
    runner = asyncio.create_task(jobs.run_pending_once())
    await asyncio.wait_for(started.wait(), 5)
    await jobs.cancel_job(job_id, owner_id="u1")
    await asyncio.wait_for(runner, 5)
    assert (await jobs.get_job(job_id))["status"] == jobs.CANCELLED


async def test_recover_running_jobs_requeues_or_fails(db):
    t = TABLES["jobs"]
    now = datetime.utcnow()
    resumable = await t.insert({"kind": "k", "status": jobs.RUNNING, "run_at": now, "created_at": now,
                                "payload": {}, "attempts": 1, "max_attempts": 3})
    exhausted = await t.insert({"kind": "k", "status": jobs.RUNNING, "run_at": now, "created_at": now,
                                "payload": {}, "attempts": 3, "max_attempts": 3})
    assert await jobs.recover_running_jobs() == 2
    assert (await jobs.get_job(resumable))["status"] == jobs.QUEUED
    assert (await jobs.get_job(exhausted))["status"] == jobs.FAILED


async def test_worker_loop_runs_jobs_and_stops_cleanly(db, monkeypatch):
    monkeypatch.setattr(jobs, "POLL_INTERVAL_SECONDS", 0.05)
    done = asyncio.Event()

    async def handler(payload):
        done.set()
        return {"x": 1}

    jobs.register_handler("t.loop", handler)
    await jobs.start_worker()
    try:
        job_id = await jobs.enqueue("t.loop", {})
        await asyncio.wait_for(done.wait(), 5)
        for _ in range(50):
            if (await jobs.get_job(job_id))["status"] == jobs.SUCCEEDED:
                break
            await asyncio.sleep(0.05)
        assert (await jobs.get_job(job_id))["status"] == jobs.SUCCEEDED
    finally:
        await jobs.stop_worker()
    assert jobs._worker_task is None


async def test_shutdown_leaves_running_job_resumable(db, monkeypatch):
    monkeypatch.setattr(jobs, "POLL_INTERVAL_SECONDS", 0.05)
    started = asyncio.Event()

    async def handler(payload):
        started.set()
        await asyncio.sleep(30)

    jobs.register_handler("t.sleepy", handler)
    await jobs.start_worker()
    job_id = await jobs.enqueue("t.sleepy", {})
    await asyncio.wait_for(started.wait(), 5)
    await jobs.stop_worker()
    assert (await jobs.get_job(job_id))["status"] == jobs.RUNNING
    await jobs.recover_running_jobs()
    assert (await jobs.get_job(job_id))["status"] == jobs.QUEUED


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _signup(api, email):
    body = {"email": email, "name": "T", "password": "Passw0rd!x", "org_name": "Org",
            "org_domain": email.split("@")[0] + ".test"}
    r = await api.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    j = r.json()
    return {"Authorization": f"Bearer {j['access_token']}"}, j["user"]["id"]


async def test_jobs_api_list_get_cancel_scoped_to_owner(api):
    ha, uid_a = await _signup(api, "ja@t.com")
    hb, _ = await _signup(api, "jb@t.com")
    job_id = await jobs.enqueue("t.x", {"secret": "payload"}, owner_id=uid_a)

    listed = (await api.get("/api/jobs", headers=ha)).json()["jobs"]
    assert [j["id"] for j in listed] == [job_id]
    assert "payload" not in listed[0]
    assert (await api.get("/api/jobs", headers=hb)).json()["jobs"] == []
    assert (await api.get(f"/api/jobs/{job_id}", headers=hb)).status_code == 404
    assert (await api.post(f"/api/jobs/{job_id}/cancel", headers=hb)).status_code == 404

    got = await api.get(f"/api/jobs/{job_id}", headers=ha)
    assert got.status_code == 200 and got.json()["status"] == "queued"
    cancelled = await api.post(f"/api/jobs/{job_id}/cancel", headers=ha)
    assert cancelled.json()["status"] == "cancelled"
    assert (await api.get("/api/jobs?status=cancelled", headers=ha)).json()["jobs"][0]["id"] == job_id


async def test_jobs_api_requires_auth(api):
    assert (await api.get("/api/jobs")).status_code in (401, 403)
