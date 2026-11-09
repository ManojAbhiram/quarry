"""Lead pipeline end to end with every external call (LLM, Serper, scraping) mocked."""
from datetime import datetime

import pytest

from app import jobs
from app.db.models import TABLES
from app.services import leads as svc
from app.services import pipeline_jobs


@pytest.fixture
async def request_row(db):
    rid = await TABLES["requests"].insert({
        "title": "Rockets", "status": "Pending", "user_id": "u1", "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(), "business_type": "aerospace", "ideal_lead_profile": "rocket makers",
    })
    return rid


def _mock_pipeline(monkeypatch, extracted, *, queries=("q1", "q2"), serper=None):
    async def normalize(p):
        return p

    async def gen(request_id, payload):
        return list(queries)

    async def fetch(qs):
        return (serper if serper is not None else [{"url": "https://acme.test", "title": "Acme"}]), None

    async def classify(results):
        return list(results), []

    async def dedup(batch):
        return batch

    async def scrape(batch, ctx, rid, uid):
        return [dict(x) for x in extracted]

    async def passthrough(leads, *a, **k):
        return leads

    async def save_standalone(*a, **k):
        return None

    monkeypatch.setattr(svc, "normalize_lead_request_payload", normalize)
    monkeypatch.setattr(svc, "_generate_and_store_queries", gen)
    monkeypatch.setattr(svc, "_fetch_all_serper_results", fetch)
    monkeypatch.setattr(svc, "process_serper_results_batch", classify)
    monkeypatch.setattr(svc, "_dedup_against_companies", dedup)
    monkeypatch.setattr(svc, "_scrape_and_extract", scrape)
    monkeypatch.setattr(svc, "_enrich_leads_with_decision_makers", passthrough)
    monkeypatch.setattr(svc, "_attach_tech_stacks_to_leads", passthrough)
    monkeypatch.setattr(svc, "process_and_save_standalone_leads", save_standalone)
    import app.services.company_enrichment as ce

    monkeypatch.setattr(ce, "enrich_leads_with_linkedin_firmographics", passthrough)
    monkeypatch.setattr(ce, "enrich_leads_with_market_signals", passthrough)


async def _status(rid):
    return await TABLES["requests"].get(_id=rid)


async def test_pipeline_completes_and_saves_leads(request_row, monkeypatch):
    good = {"company_name": "Acme", "website": "https://acme.test", "source_url": "https://acme.test/about",
            "match_score": "82", "buying_signals": "hiring"}
    _mock_pipeline(monkeypatch, [good])
    out = await svc.run_lead_pipeline(request_row, {"user_id": "u1", "num_leads": 1, "title": "Rockets"})
    assert len(out) == 1
    req = await _status(request_row)
    assert req["status"] == "Completed"
    rows = await TABLES["leads"].find()
    assert len(rows) == 1 and rows[0]["match_score"] == 82.0
    assert rows[0]["enrichment_failed"] is False


async def test_failed_enrichment_is_persisted_and_exposed(request_row, monkeypatch):
    failed = {"company_name": "Acme", "website": "https://acme.test", "source_url": "https://acme.test",
              "enrichment_failed": True, "enrichment_failure_reason": "The AI provider was unreachable or rejected the request."}
    _mock_pipeline(monkeypatch, [failed])
    await svc.run_lead_pipeline(request_row, {"user_id": "u1", "num_leads": 1})
    from app.db.leads import get_normalized_leads_for_request

    leads = await get_normalized_leads_for_request(request_row)
    assert leads[0]["enrichment_failed"] is True
    assert "AI provider" in leads[0]["enrichment_failure_reason"]


async def test_no_queries_fails_the_request_with_reason(request_row, monkeypatch):
    _mock_pipeline(monkeypatch, [], queries=())
    assert await svc.run_lead_pipeline(request_row, {"user_id": "u1"}) == []
    req = await _status(request_row)
    assert req["status"] == "Failed" and "search queries" in req["failure_reason"]


async def test_no_serper_results_fails_the_request(request_row, monkeypatch):
    _mock_pipeline(monkeypatch, [], serper=[])
    assert await svc.run_lead_pipeline(request_row, {"user_id": "u1"}) == []
    assert (await _status(request_row))["status"] == "Failed"


async def test_icp_filter_applied_only_when_enabled(request_row, monkeypatch):
    from app.core.config import settings

    low = {"company_name": "Low", "website": "https://low.test", "source_url": "https://low.test", "match_score": "5"}
    _mock_pipeline(monkeypatch, [low])
    await svc.run_lead_pipeline(request_row, {"user_id": "u1", "num_leads": 1})
    assert len(await TABLES["leads"].find()) == 1  # default: non-destructive

    await TABLES["leads"].delete_where()
    monkeypatch.setattr(settings, "ICP_FILTER_ENABLED", True)
    monkeypatch.setattr(svc, "ICP_SCORE_THRESHOLD", 60)
    await svc.run_lead_pipeline(request_row, {"user_id": "u1", "num_leads": 1})
    assert len(await TABLES["leads"].find()) == 0


async def test_background_wrapper_marks_request_failed_on_crash(request_row, monkeypatch):
    async def explode(rid, payload):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(svc, "run_lead_pipeline", explode)
    await svc.run_pipeline_background(request_row, {}, "u1")
    req = await _status(request_row)
    assert req["status"] == "Failed" and "RuntimeError" in req["failure_reason"]


# ── job handlers ─────────────────────────────────────────────────────────────

async def test_pipeline_job_handler_runs_and_fails_permanently_on_failed_request(request_row, monkeypatch):
    async def key(uid):
        return "serper-key"

    monkeypatch.setattr(pipeline_jobs, "get_user_serper_key", key)
    calls = []

    async def fake_bg(rid, payload, uid, k=None):
        calls.append((rid, uid, k))
        await svc.update_request_status(rid, "Completed")

    monkeypatch.setattr(svc, "run_pipeline_background", fake_bg)
    result = await pipeline_jobs.handle_pipeline_run(
        {"request_id": request_row, "pipeline_payload": {}, "product_desc": "", "user_id": "u1"}
    )
    assert result["request_status"] == "Completed" and calls == [(request_row, "u1", "serper-key")]

    async def fake_fail(rid, payload, uid, k=None):
        await svc.update_request_status(rid, "Failed", failure_reason="no results")

    monkeypatch.setattr(svc, "run_pipeline_background", fake_fail)
    with pytest.raises(jobs.PermanentJobError, match="no results"):
        await pipeline_jobs.handle_pipeline_run(
            {"request_id": request_row, "pipeline_payload": {}, "product_desc": "", "user_id": "u1"}
        )


async def test_pipeline_job_requires_serper_key_and_existing_request(request_row, monkeypatch):
    async def nokey(uid):
        return None

    monkeypatch.setattr(pipeline_jobs, "get_user_serper_key", nokey)
    with pytest.raises(jobs.PermanentJobError, match="Serper"):
        await pipeline_jobs.handle_pipeline_run({"request_id": request_row, "user_id": "u1"})


async def test_resumed_job_resets_stale_failed_status(request_row, monkeypatch):
    async def key(uid):
        return "k"

    monkeypatch.setattr(pipeline_jobs, "get_user_serper_key", key)
    await svc.update_request_status(request_row, "Failed", failure_reason="interrupted")
    seen = {}

    async def fake_bg(rid, payload, uid, k=None):
        seen["status"] = (await _status(rid))["status"]
        await svc.update_request_status(rid, "Completed")

    monkeypatch.setattr(svc, "run_pipeline_background", fake_bg)
    await pipeline_jobs.handle_pipeline_run({"request_id": request_row, "user_id": "u1"})
    assert seen["status"] == "Pending"


async def test_pending_pipeline_request_ids_excluded_from_orphan_sweep(request_row):
    from app.db.requests import fail_orphaned_requests

    await jobs.enqueue(pipeline_jobs.PIPELINE_RUN, {"request_id": request_row, "user_id": "u1"}, owner_id="u1")
    keep = await pipeline_jobs.pending_pipeline_request_ids()
    assert keep == {request_row}
    assert await fail_orphaned_requests(exclude_ids=keep) == 0
    assert (await _status(request_row))["status"] == "Pending"
    assert await fail_orphaned_requests() == 1


async def test_launch_falls_back_to_background_tasks_if_enqueue_fails(db, monkeypatch):
    from fastapi import BackgroundTasks

    from app.api import request_intake

    async def broken(*a, **k):
        raise RuntimeError("db locked")

    monkeypatch.setattr(request_intake.jobs, "enqueue", broken)
    bt = BackgroundTasks()

    async def fallback_fn(x):
        return x

    await request_intake._launch_durable(bt, "u1", "r1", "pipeline.run", {}, fallback=(fallback_fn, 1))
    assert len(bt.tasks) == 1


async def test_retry_lead_enrichment_clears_failure_marker(request_row, monkeypatch):
    lead_id = await TABLES["leads"].insert({
        "request_id": request_row, "user_id": "u1", "url": "https://acme.test", "title": "Acme",
        "enrichment_status": "enriched", "enrichment_failed": True, "enrichment_failure_reason": "down",
        "match_score": 0.0,
    })

    async def scrape(items, ctx, rid, uid):
        return [{"company_name": "Acme", "website": "https://acme.test", "source_url": "https://acme.test",
                 "match_score": "70"}]

    monkeypatch.setattr(svc, "_scrape_and_extract", scrape)
    res = await svc.retry_lead_enrichment(lead_id, "u1")
    assert res["enrichment_failed"] is False
    row = await TABLES["leads"].get(_id=lead_id)
    assert row["enrichment_failed"] is False and row["match_score"] == 70.0
    assert len(await TABLES["leads"].find()) == 1  # updated in place, not duplicated


async def test_retry_lead_enrichment_unknown_or_foreign_lead(request_row):
    with pytest.raises(LookupError):
        await svc.retry_lead_enrichment("missing", "u1")
