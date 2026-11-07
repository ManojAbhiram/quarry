from datetime import datetime, timedelta

from app.db import competitor_analyses as analyses
from app.db import icp_profiles, product_intake
from app.db import requests as reqs


async def _mk(user_id="u1", status="Draft", updated=None, **extra):
    now = datetime.utcnow()
    return await reqs.create_draft_request(
        {"user_id": user_id, "status": status, "created_at": now, "updated_at": updated or now, **extra}
    )


async def test_get_request_by_id_scoped_to_user(db):
    rid = await _mk(user_id="u1", title="mine")
    assert (await reqs.get_request_by_id(rid, "u1"))["title"] == "mine"
    assert await reqs.get_request_by_id(rid, "someone-else") is None


async def test_list_user_requests_sorted_by_updated_at_desc(db):
    now = datetime.utcnow()
    old = await _mk(updated=now - timedelta(days=2))
    new = await _mk(updated=now)
    await _mk(user_id="other")
    got = await reqs.list_user_requests("u1")
    assert [d["_id"] for d in got] == [new, old]


async def test_get_user_request_stats_counts_by_status(db):
    await _mk(status="Draft")
    await _mk(status="Draft")
    await _mk(status="Completed")
    await _mk(user_id="other", status="Failed")
    assert await reqs.get_user_request_stats("u1") == {"Draft": 2, "Completed": 1}


async def test_update_request_status_sets_time_taken(db):
    rid = await _mk()
    await reqs.update_request_status(rid, "Completed", time_taken=12.5)
    doc = await reqs.get_request_by_id(rid, "u1")
    assert doc["status"] == "Completed" and doc["time_taken"] == 12.5


async def test_update_request_fields_returns_updated_doc(db):
    rid = await _mk(title="a")
    doc = await reqs.update_request_fields(rid, {"title": "b"})
    assert doc["title"] == "b" and doc["_id"] == rid


async def test_add_queries_to_lead_request_appends(db):
    rid = await _mk(queries=["q1"])
    await reqs.add_queries_to_lead_request(rid, ["q2", "q3"])
    assert (await reqs.get_request_status_doc(rid, "u1"))["queries"] == ["q1", "q2", "q3"]


async def test_replace_request_overwrites_document(db):
    rid = await _mk(title="old", leftover=1)
    await reqs.replace_request(rid, {"user_id": "u1", "status": "Pending", "title": "new"})
    doc = await reqs.get_request_by_id(rid, "u1")
    assert doc["title"] == "new" and "leftover" not in doc


async def test_delete_user_requests_removes_all_for_user_only(db):
    a = await _mk(user_id="u1")
    await _mk(user_id="u1")
    keep = await _mk(user_id="u2")
    await reqs.delete_user_requests("u1")
    assert await reqs.get_request_by_id(a, "u1") is None
    assert await reqs.get_request_by_id(keep, "u2") is not None
    assert await reqs.delete_request_by_id(keep) is True
    assert await reqs.delete_request_by_id(keep) is False


async def test_insert_complete_lead_request_defaults(db):
    rid = await reqs.insert_complete_lead_request({"title": "t"}, "u9")
    doc = await reqs.get_request_by_id(rid, "u9")
    assert doc["status"] == "Pending" and doc["created_at"] is not None


async def test_upsert_icp_profile_is_idempotent_per_request(db):
    first = await icp_profiles.upsert_icp_profile("r1", {"firmographic": {"a": 1}}, queries=["q"])
    second = await icp_profiles.upsert_icp_profile("r1", {"firmographic": {"a": 2}})
    assert first == second
    got = await icp_profiles.get_icp_profile("r1")
    assert got["firmographic"] == {"a": 2} and got["queries"] == ["q"] and got["generated_at"] is not None
    assert (await icp_profiles.get_icp_profiles_by_request_ids(["r1", "nope"])).keys() == {"r1"}


async def test_upsert_product_intake_keeps_created_at(db):
    first = await product_intake.upsert_product_intake("r1", {"product_name": "A"})
    created = (await product_intake.get_product_intake("r1"))["created_at"]
    second = await product_intake.upsert_product_intake("r1", {"product_name": "B"})
    got = await product_intake.get_product_intake("r1")
    assert first == second and got["product_name"] == "B" and got["created_at"] == created
    assert (await product_intake.get_product_intakes_by_request_ids(["r1"])).keys() == {"r1"}


async def test_competitor_url_unique_per_analysis(db):
    aid = await analyses.upsert_competitor_analysis("r1", "u1", "desc")
    comp = {"url": "https://c.com", "company_name": "C", "match_score": 50}
    await analyses.save_competitors_to_analysis(aid, [comp])
    await analyses.save_competitors_to_analysis(aid, [{**comp, "match_score": 80}])
    rows = await analyses.list_competitors_for_analysis(aid)
    assert len(rows) == 1 and rows[0]["match_score"] == 80


async def test_list_competitors_sorted_by_score_and_user_scoped_analysis(db):
    aid = await analyses.upsert_competitor_analysis("r1", "u1")
    await analyses.save_competitors_to_analysis(
        aid, [{"url": "https://a.com", "match_score": 10}, {"url": "https://b.com", "match_score": 90}]
    )
    assert [c["url"] for c in await analyses.list_competitors_for_analysis(aid)] == ["https://b.com", "https://a.com"]
    assert (await analyses.get_competitor_analysis_for_user("r1", "u1"))["_id"] == aid
    assert await analyses.get_competitor_analysis_for_user("r1", "u2") is None
    await analyses.update_competitor_analysis_status("r1", "Completed")
    assert (await analyses.get_competitor_analysis("r1"))["status"] == "Completed"
