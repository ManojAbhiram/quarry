"""Launch estimate, usage metering, sample run and quota."""
from datetime import datetime

import pytest

from app import usage
from app.core.security_crypto import encrypt_secret
from app.db.models import TABLES
from app.services import llm, serper

ICP = {
    "firmographic": {"value": "- SaaS\n- 50-500 employees\n- US"},
    "technographic": {"value": "- Snowflake\n- dbt"},
    "team_structure": "- data team of 5",
    "buying_signals": "", "compliance": "", "deployment_pref": "",
}


def body(num_leads=10):
    return {
        "product_intake": {
            "product_name": "Acme", "product_category": "Analytics", "one_liner": "x", "deployment_model": "SaaS",
            "primary_value_prop": "y", "pricing_model": "Seat", "existing_competitors": "z", "deal_size_acv": "$20K",
            "target_geographies": "US", "product_description": "desc",
        },
        "icp_dimensions": {k: (v if isinstance(v, dict) else {"value": v}) for k, v in ICP.items()},
        "num_leads": num_leads,
    }


# ── estimate ─────────────────────────────────────────────────────────────────

def test_icp_size_counts_non_empty_criteria_lines():
    assert usage.icp_size(ICP) == 6
    assert usage.icp_size(None) == 0 and usage.icp_size({"a": ""}) == 0


def test_estimate_scales_with_leads_and_icp_and_has_a_range():
    small, big = usage.estimate_run(10, ICP), usage.estimate_run(50, ICP)
    assert big["search_calls"] > small["search_calls"] and big["llm_calls"] > small["llm_calls"]
    c = small["cost_usd"]
    assert 0 < c["low"] < c["typical"] < c["high"]
    assert usage.estimate_run(10, {k: "- a\n" * 20 for k in ICP})["search_calls"] > small["search_calls"]
    assert small["assumptions"] and small["icp_size"] == 6
    assert usage.estimate_run(0)["num_leads"] == 1  # never zero


def test_cost_of_uses_unit_prices(monkeypatch):
    monkeypatch.setattr(usage, "SERPER_USD_PER_CALL", 0.01)
    monkeypatch.setattr(usage, "LLM_USD_PER_CALL", 0.1)
    assert usage.cost_of(10, 2) == pytest.approx(0.3)


def test_direct_estimate():
    assert usage.estimate_direct(5)["search_calls"] == 20


# ── metering ─────────────────────────────────────────────────────────────────

async def test_count_outside_a_run_is_a_noop():
    usage.count("serper")  # must not raise


async def test_tracked_records_actual_counts_over_the_launch_estimate(db):
    await usage.begin_run("u1", "r1", usage.estimate_run(10, ICP))
    before = (await TABLES["usage_events"].get(user_id="u1", request_id="r1"))
    assert before["estimated"] is True and before["cost_usd"] > 0

    async with usage.tracked("u1", "r1"):
        usage.count("serper", 3)
        usage.count("llm", 2)
        async with usage.tracked("u1", "r1"):  # nested joins the outer run
            usage.count("serper")
    ev = await TABLES["usage_events"].get(user_id="u1", request_id="r1")
    assert ev["_id"] == before["_id"] and ev["estimated"] is False
    assert (ev["serper_calls"], ev["llm_calls"]) == (4, 2)
    assert ev["cost_usd"] == usage.cost_of(4, 2)


async def test_tracked_with_no_calls_records_nothing_and_survives_errors(db):
    async with usage.tracked("u1", "r9"):
        pass
    assert await TABLES["usage_events"].get(request_id="r9") is None
    with pytest.raises(RuntimeError):
        async with usage.tracked("u1", "r8"):
            usage.count("llm")
            raise RuntimeError("pipeline blew up")
    assert (await TABLES["usage_events"].get(request_id="r8"))["llm_calls"] == 1  # still counted


async def test_serper_and_llm_helpers_feed_the_meter(db, monkeypatch):
    import httpx

    class Resp:
        def raise_for_status(self): ...
        def json(self): return {"organic": []}

    class Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): ...
        async def post(self, *a, **k): return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", Client)

    async def fake_completion(**kw):
        from types import SimpleNamespace as NS

        return NS(choices=[NS(message=NS(content="{}"))])

    monkeypatch.setattr(llm, "acompletion", fake_completion)
    async with usage.tracked("u1", "rq"):
        await serper.fetch_leads_from_serper("q")
        await llm._llm_json_completion(model="m", system_prompt="s", user_prompt="u")
    ev = await TABLES["usage_events"].get(request_id="rq")
    assert ev["serper_calls"] == 1 and ev["llm_calls"] >= 1


# ── summary and quota ────────────────────────────────────────────────────────

async def test_summary_counts_this_month_only(db):
    ev = TABLES["usage_events"]
    await ev.insert({"user_id": "u1", "kind": "run", "request_id": "a", "serper_calls": 10, "llm_calls": 5, "cost_usd": 0.02, "created_at": datetime.utcnow()})
    await ev.insert({"user_id": "u1", "kind": "sample", "serper_calls": 1, "llm_calls": 1, "cost_usd": 0.003, "created_at": datetime.utcnow()})
    await ev.insert({"user_id": "u1", "kind": "run", "request_id": "old", "cost_usd": 9.0, "created_at": datetime(2020, 1, 1)})
    await ev.insert({"user_id": "u2", "kind": "run", "request_id": "other", "cost_usd": 5.0, "created_at": datetime.utcnow()})
    s = await usage.get_summary("u1")
    assert s["runs"] == 1 and s["samples"] == 1 and s["search_calls"] == 11 and s["llm_calls"] == 6
    assert s["cost_usd"] == pytest.approx(0.023)
    assert s["quota"]["runs_left"] == usage.RUN_QUOTA - 1 and len(s["recent"]) == 2


async def test_check_quota_blocks_on_runs_and_on_budget(db, monkeypatch):
    monkeypatch.setattr(usage, "RUN_QUOTA", 2)
    await usage.check_quota("u1")  # fine when empty
    for i in range(2):
        await usage.begin_run("u1", f"r{i}", {"cost_usd": {"typical": 0.01}})
    with pytest.raises(usage.HTTPException) as e:
        await usage.check_quota("u1")
    assert e.value.status_code == 429 and "Monthly run limit" in e.value.detail

    with pytest.raises(usage.HTTPException) as e:
        await usage.check_quota("u3", {"quota_cost_monthly_usd": 0.5}, {"cost_usd": {"typical": 0.8}})
    assert e.value.status_code == 429 and "budget" in e.value.detail
    await usage.check_quota("u3", {"quota_cost_monthly_usd": 5}, {"cost_usd": {"typical": 0.8}})  # fits


# ── API ──────────────────────────────────────────────────────────────────────

async def test_estimate_and_summary_routes(api, signup):
    h, _ = await signup()
    r = await api.post("/api/usage/estimate", headers=h, json={"num_leads": 20, "icp_dimensions": ICP})
    assert r.status_code == 200
    j = r.json()
    assert j["search_calls"] > 0 and j["fits_quota"] is True and j["quota"]["runs_left"] > 0
    assert (await api.post("/api/usage/estimate", headers=h, json={"num_leads": 0})).status_code == 422
    s = (await api.get("/api/usage/summary", headers=h)).json()
    assert s["runs"] == 0 and s["quota"]["runs"] == usage.RUN_QUOTA
    api.cookies.clear()  # signup set a session cookie
    assert (await api.get("/api/usage/summary")).status_code == 401


async def test_sample_run_returns_a_few_candidates_and_records_cost(api, signup, monkeypatch):
    h, uid = await signup()
    await TABLES["users"].update(uid, {"serper_api_key_encrypted": encrypt_secret("serper-key-123")})
    seen = {}

    async def fake_queries(payload):
        seen["profile"] = payload["ideal_lead_profile"]
        return ["q one", "q two"]

    async def fake_search(query):
        seen["query"] = query
        seen["key"] = serper.current_serper_key.get()
        return {"organic": [{"title": f"T{i}", "link": f"https://c{i}.com", "snippet": "s"} for i in range(8)] + [{"title": "nolink"}]}

    monkeypatch.setattr(llm, "generate_sales_queries", fake_queries)
    monkeypatch.setattr(serper, "fetch_leads_from_serper", fake_search)
    r = await api.post("/api/usage/sample-run", headers=h, json=body(25))
    assert r.status_code == 200, r.text
    j = r.json()
    assert seen["query"] == "q one" and seen["key"] == "serper-key-123" and "Acme" in seen["profile"]
    assert len(j["samples"]) == 5 and j["samples"][0]["url"] == "https://c0.com" and j["queries_planned"] == 2
    assert j["sample_cost_usd"] == usage.cost_of(1, 1)
    assert j["full_run"]["num_leads"] == 25 and j["full_run"]["cost_usd"]["typical"] > j["sample_cost_usd"]
    summary = (await api.get("/api/usage/summary", headers=h)).json()
    assert summary["samples"] == 1 and summary["cost_usd"] == pytest.approx(j["sample_cost_usd"])


async def test_sample_run_needs_a_key_and_handles_failures(api, signup, monkeypatch):
    h, uid = await signup()
    assert (await api.post("/api/usage/sample-run", headers=h, json=body())).status_code == 400
    await TABLES["users"].update(uid, {"serper_api_key_encrypted": encrypt_secret("serper-key-123")})

    async def none(payload):
        return []

    monkeypatch.setattr(llm, "generate_sales_queries", none)
    assert (await api.post("/api/usage/sample-run", headers=h, json=body())).status_code == 422

    async def some(payload):
        return ["q"]

    async def boom(q):
        raise RuntimeError("serper down")

    monkeypatch.setattr(llm, "generate_sales_queries", some)
    monkeypatch.setattr(serper, "fetch_leads_from_serper", boom)
    assert (await api.post("/api/usage/sample-run", headers=h, json=body())).status_code == 502


async def test_sample_run_is_rate_limited_per_day(api, signup, monkeypatch):
    h, uid = await signup()
    await TABLES["users"].update(uid, {"serper_api_key_encrypted": encrypt_secret("serper-key-123")})
    for _ in range(10):
        await usage.record_sample(uid, 1, 1)
    assert (await api.post("/api/usage/sample-run", headers=h, json=body())).status_code == 429


async def test_launch_is_blocked_when_quota_is_used_up(api, signup, monkeypatch):
    h, uid = await signup()
    await TABLES["users"].update(uid, {
        "serper_api_key_encrypted": encrypt_secret("serper-key-123"), "quota_runs_monthly": 1,
    })
    await usage.begin_run(uid, "earlier", {"cost_usd": {"typical": 0.01}})
    r = await api.post("/api/requests/launch", headers=h, json=body())
    assert r.status_code == 429 and "Monthly run limit" in r.json()["detail"]
