from datetime import datetime, timedelta

from app.db import companies, decision_makers, leads, signals
from app.db.models import TABLES

ENRICHED = {
    "company_name": "Acme",
    "source_url": "https://acme.com",
    "website": "https://acme.com",
    "match_score": "85/100",
    "contact_email": "a@acme.com",
    "industry": "SaaS",
    "tech_stack": ["React"],
    "buying_signals": "hiring",
    "signals": ["s1"],
    "decision_makers": [{"name": "Ann", "title": "CTO", "linkedin_url": "https://linkedin.com/in/ann"}],
}


async def _seed(request_id="r1", user_id="u1", **over):
    await leads.save_enriched_leads_to_db(request_id, user_id, [{**ENRICHED, **over}])


async def test_save_leads_skips_duplicate_url_for_same_request(db):
    data = [{"title": "A", "url": "https://a.com"}, {"title": "A again", "url": "https://a.com"}]
    await leads.process_and_save_standalone_leads(data, "r1", "u1")
    await leads.process_and_save_standalone_leads(data, "r2", "u1")  # other request may reuse the url
    assert await leads.count_leads_for_request("r1") == 1
    assert await leads.count_leads_for_request("r2") == 1


async def test_save_enriched_twice_updates_in_place(db):
    await _seed()
    await _seed(match_score="90/100")
    rows = await TABLES["leads"].find()
    assert len(rows) == 1 and rows[0]["match_score"] == 90.0
    assert len(await TABLES["lead_enrichments"].find()) == 1
    assert len(await TABLES["decision_makers"].find()) == 1
    assert len(await TABLES["companies"].find()) == 1


async def test_upsert_company_unique_on_canonical_domain(db):
    a = await companies.upsert_company({"company_name": "Acme", "website": "https://www.acme.com/about"})
    b = await companies.upsert_company({"company_name": "Acme Inc", "website": "https://acme.com"})
    assert a == b
    assert (await companies.get_company_by_id(a))["company_name"] == "Acme Inc"
    assert (await companies.get_company_by_domain("https://acme.com"))["_id"] == a
    assert await companies.upsert_company({"company_name": "No domain"}) is None


async def test_insert_decision_maker_if_new_dedupes(db):
    dm = {"name": "Ann", "title": "CTO", "linkedin_url": "https://linkedin.com/in/ann"}
    await decision_makers.insert_decision_maker_if_new("L1", dm)
    await decision_makers.insert_decision_maker_if_new("L1", dm)
    await decision_makers.insert_decision_maker_if_new("L2", dm)
    assert len(await decision_makers.get_decision_makers_for_lead("L1")) == 1
    assert await decision_makers.count_decision_makers_by_lead(["L1", "L2", "L3"]) == {"L1": 1, "L2": 1}


async def test_get_decision_makers_for_request_attaches_company_name(db):
    await _seed()
    got = await decision_makers.get_decision_makers_for_request("r1")
    assert len(got) == 1 and got[0]["company_name"] == "Acme" and got[0]["name"] == "Ann"
    assert await decision_makers.get_decision_makers_for_request("nope") == []


async def test_count_enriched_leads_by_request(db):
    await _seed("r1", company_name="Acme", source_url="https://acme.com", match_score="80/100")
    await _seed("r1", company_name="Beta", source_url="https://beta.com", website="https://beta.com", match_score="60/100")
    await _seed("r2", company_name="Gamma", source_url="https://gamma.com", website="https://gamma.com", match_score="10/100")
    await leads.process_and_save_standalone_leads([{"title": "Raw", "url": "https://raw.com"}], "r1", "u1")  # not enriched
    got = await leads.count_enriched_leads_by_request(["r1", "r2", "r3"])
    assert set(got) == {"r1", "r2"}
    assert got["r1"]["count"] == 2 and got["r1"]["avg_score"] == 70.0
    assert sorted(got["r1"]["companies"]) == ["Acme", "Beta"]
    assert len(got["r1"]["lead_ids"]) == 2 and got["r1"]["legacy_dm_count"] == 0
    assert got["r2"]["count"] == 1


async def test_get_normalized_leads_for_request_matches_shape(db):
    await _seed(email_verified=True)
    got = await leads.get_normalized_leads_for_request("r1")
    assert len(got) == 1
    lead = got[0]
    assert lead["id"] == lead["_id"] and lead["user_id"] == "u1"
    assert lead["company_name"] == "Acme" and lead["industry"] == "SaaS" and lead["tech_stack"] == ["React"]
    assert lead["match_score"] == "85.0" and lead["type"] == "enriched" and lead["email"] == "a@acme.com"
    assert lead["buying_signals"] == "hiring" and lead["signals"] == ["s1"]
    assert lead["decision_makers"][0]["name"] == "Ann" and lead["decision_makers"][0]["recent_posts"] == []
    assert lead["email_verified"] is True
    expected = {
        "id", "_id", "user_id", "title", "url", "email", "phone", "email_verified", "email_confidence",
        "match_score", "snippet", "type", "company_name", "industry", "location", "employee_size_estimate",
        "funding_stage", "founded_year", "linkedin_url", "x_url", "facebook_url", "growth", "tech_stack",
        "infrastructure", "contact_name", "contact_title", "buying_signals", "match_explanation", "signals",
        "decision_makers", "intent_score", "intent_band", "band_emoji", "band_action", "intent_signals",
        "intent_summary", "score_breakdown", "pillar_details", "total_signals", "intent_score_updated_at",
        "signal_timeline", "serper_queries_used",
    }
    assert set(lead) == expected
    assert await leads.get_normalized_leads_for_request("nope") == []


async def test_normalized_leads_sorted_by_score_desc(db):
    await _seed("r1", company_name="Low", source_url="https://low.com", website="https://low.com", match_score="10/100")
    await _seed("r1", company_name="High", source_url="https://high.com", website="https://high.com", match_score="99/100")
    assert [x["company_name"] for x in await leads.get_normalized_leads_for_request("r1")] == ["High", "Low"]


async def test_save_intent_analysis_updates_lead_by_index(db):
    await _seed()
    ok = await signals.save_intent_analysis("r1", 0, {"intent_score": 77, "intent_band": "HOT", "total_signals": 3})
    assert ok is True
    lead = (await leads.get_normalized_leads_for_request("r1"))[0]
    assert lead["intent_score"] == 77 and lead["intent_band"] == "HOT" and lead["total_signals"] == 3
    assert await signals.save_intent_analysis("r1", 5, {}) is False
    assert (await signals.get_lead_with_intent("r1", 0, "u1"))["intent_score"] == 77


async def test_get_lead_for_user_and_update_fields(db):
    await _seed()
    lead_id = (await leads.get_normalized_leads_for_request("r1"))[0]["_id"]
    assert (await leads.get_lead_for_user(lead_id, "u1"))["_id"] == lead_id
    assert await leads.get_lead_for_user(lead_id, "other") is None
    await leads.update_lead_fields(lead_id, {"email_verified": False, "email_confidence": 0.4})
    got = await leads.get_lead_for_user(lead_id, "u1")
    assert got["email_verified"] is False and got["email_confidence"] == 0.4


async def test_serper_cache_roundtrip_and_expiry(db):
    assert await signals.get_cached_serper_result("q") is None
    await signals.cache_serper_result("q", [{"title": "x"}])
    await signals.cache_serper_result("q", [{"title": "y"}])  # overwrite, still one row
    assert await signals.get_cached_serper_result("q") == [{"title": "y"}]
    await TABLES["serper_cache"].upsert({"query": "old"}, {"results": [1], "expires_at": datetime.utcnow() - timedelta(days=1)})
    assert await signals.get_cached_serper_result("old") is None


async def test_fetch_enrich_map_combines_intake_icp_and_lead_counts(db):
    from app.db import icp_profiles, product_intake
    from app.services.requests import _fetch_enrich_map

    await product_intake.upsert_product_intake("r1", {"product_name": "Quarry"})
    await icp_profiles.upsert_icp_profile("r1", {"firmographic": {"size": "50"}}, queries=["q"])
    await _seed("r1")
    got = await _fetch_enrich_map(["r1", "r2"])
    assert got["r1"]["product_intake"] == {"product_name": "Quarry"}
    assert got["r1"]["icp_dimensions"] == {"firmographic": {"size": "50"}}
    assert got["r1"]["leads_agg"]["count"] == 1 and got["r1"]["leads_agg"]["decision_makers_count"] == 1
    assert got["r2"] == {"product_intake": {}, "icp_dimensions": {}, "leads_agg": {}}
    assert await _fetch_enrich_map([]) == {}


async def test_request_status_summary_counts_leads_and_queries(db):
    from app.db import requests as reqs
    from app.services.leads import get_request_status_summary

    rid = await reqs.insert_complete_lead_request({"title": "t", "queries": ["a", "b"]}, "u1")
    await leads.process_and_save_standalone_leads([{"title": "X", "url": "https://x.com"}], rid, "u1")
    got = await get_request_status_summary(rid, "u1")
    assert got == {"request_id": rid, "status": "Pending", "leads_count": 1, "queries_count": 2}


async def test_verify_email_persists_on_lead_via_api(db, monkeypatch):
    import httpx

    from app.api import leads as leads_api
    from app.main import app
    from app.services.auth import get_current_user

    await _seed()
    lead_id = (await leads.get_normalized_leads_for_request("r1"))[0]["_id"]

    async def fake_verify(email):
        return {"verified": True, "confidence": 0.9, "method": "smtp", "reason": "ok"}

    monkeypatch.setattr(leads_api, "verify_email", fake_verify)
    app.dependency_overrides[get_current_user] = lambda: {"_id": "u1", "email": "x@y.z"}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            routes = [r for r in app.openapi()["paths"] if "verify" in r and "{lead_id}" in r]
            assert routes, "verify-email route missing"
            resp = await c.post(routes[0].replace("{lead_id}", lead_id))
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    got = await leads.get_lead_for_user(lead_id, "u1")
    assert got["email_verified"] is True and got["email_confidence"] == 0.9


async def test_concurrent_readers_and_writers_lose_nothing(db):
    """25 pipeline workers saving leads into one request while the results page keeps reading it:
    no 'database is locked', no silently lost rows."""
    import asyncio

    async def worker(i):
        items = [
            {**ENRICHED, "company_name": f"C{i}-{j}", "source_url": f"https://c{i}-{j}.com",
             "website": f"https://c{i}-{j}.com", "buying_signals": "x" * 2000,
             "decision_makers": [{"name": "a", "linkedin_url": f"l{i}-{j}"}]}
            for j in range(4)
        ]
        await leads.save_enriched_leads_to_db("r1", "u1", items)
        await leads.get_normalized_leads_for_request("r1")

    await asyncio.gather(*[worker(i) for i in range(25)])
    assert await leads.count_leads_for_request("r1") == 100
