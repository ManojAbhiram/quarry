"""Suppression ledger, opt-out links, erasure by email, audit log, retention and export compliance."""
import csv
import io
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from app import suppression as sup
from app.compliance import audit, optout, retention
from app.compliance.person_erasure import erase_person_by_email
from app.db import engine
from app.db.models import TABLES, DecisionMaker, Lead

# ── ledger ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("Jane@Acme.COM", ("email", "jane@acme.com")),
    ("acme.com", ("domain", "acme.com")),
    ("@acme.com", ("domain", "acme.com")),
    ("https://www.acme.com/about", ("domain", "acme.com")),
])
def test_normalize(raw, expected):
    assert sup.normalize(raw) == expected


@pytest.mark.parametrize("bad", ["", "   ", "nodot", "a@b", "two words"])
def test_normalize_rejects_garbage(bad):
    with pytest.raises(ValueError):
        sup.normalize(bad)


async def test_add_is_idempotent_and_is_suppressed_matches_email_and_domain(db):
    a = await sup.add_suppression("o1", "Jane@acme.com", "asked", "manual")
    b = await sup.add_suppression("o1", "jane@ACME.com", "again", "manual")
    assert a["_id"] == b["_id"] and len(await sup.list_suppressions("o1")) == 1
    assert await sup.is_suppressed("o1", "jane@acme.com")
    assert await sup.is_suppressed("o1", "JANE@ACME.COM")
    assert not await sup.is_suppressed("o1", "bob@acme.com")

    await sup.add_suppression("o1", "evil.com", "", "complaint")
    assert await sup.is_suppressed("o1", "anyone@evil.com")
    assert await sup.is_suppressed("o1", "anyone@eng.evil.com")  # subdomain
    assert not await sup.is_suppressed("o1", "anyone@notevil.com")


async def test_is_suppressed_handles_blank_and_other_owners(db):
    await sup.add_suppression("o1", "acme.com", "", "manual")
    assert not await sup.is_suppressed("o1", "")
    assert not await sup.is_suppressed("o1", "not an email")
    assert not await sup.is_suppressed("o2", "x@acme.com")  # per-owner ledger


async def test_remove_by_value_and_id_only_touches_own_entries(db):
    e = await sup.add_suppression("o1", "a@acme.com", "", "manual")
    await sup.add_suppression("o1", "b.com", "", "manual")
    assert not await sup.remove_suppression("o2", e["_id"])
    assert await sup.remove_suppression("o1", e["_id"])
    assert await sup.remove_suppression("o1", "B.com")
    assert not await sup.remove_suppression("o1", "b.com")
    assert not await sup.remove_suppression("o1", "")
    assert await sup.list_suppressions("o1") == []


async def test_unknown_source_is_stored_as_manual(db):
    assert (await sup.add_suppression("o1", "x@acme.com", "", "weird"))["source"] == "manual"


# ── API: suppression + opt-out ───────────────────────────────────────────────

async def test_suppression_api_crud(api, signup):
    h, _ = await signup()
    r = await api.post("/api/compliance/suppressions", headers=h, json={"value": "Jane@Acme.com", "reason": "asked"})
    assert r.status_code == 201 and r.json()["value"] == "jane@acme.com" and r.json()["kind"] == "email"
    assert (await api.post("/api/compliance/suppressions", headers=h, json={"value": "nonsense"})).status_code == 400
    listed = (await api.get("/api/compliance/suppressions", headers=h)).json()
    assert listed["total"] == 1
    assert (await api.delete("/api/compliance/suppressions", headers=h, params={"value": "jane@acme.com"})).status_code == 204
    assert (await api.delete("/api/compliance/suppressions", headers=h, params={"value": "jane@acme.com"})).status_code == 404
    assert (await api.get("/api/compliance/suppressions")).status_code == 401


async def test_suppression_api_is_per_user(api, signup):
    h1, _ = await signup("a@t.com")
    h2, _ = await signup("b@t.com")
    await api.post("/api/compliance/suppressions", headers=h1, json={"value": "x@acme.com"})
    assert (await api.get("/api/compliance/suppressions", headers=h2)).json()["total"] == 0


async def test_public_opt_out_flow_needs_no_auth_and_adds_to_ledger(api, signup):
    h, uid = await signup()
    link = (await api.post("/api/compliance/opt-out-link", headers=h, json={"email": "Jane@acme.com"})).json()["url"]
    assert "/opt-out?token=" in link
    token = link.split("token=")[1]

    info = await api.get("/api/public/opt-out", params={"token": token})  # no Authorization header
    assert info.status_code == 200 and info.json() == {"email_masked": "j***@acme.com", "already_opted_out": False}
    assert not await sup.is_suppressed(uid, "jane@acme.com")

    done = await api.post("/api/public/opt-out", json={"token": token})
    assert done.status_code == 200 and done.json()["opted_out"] is True
    assert await sup.is_suppressed(uid, "jane@acme.com")
    entry = (await sup.list_suppressions(uid))[0]
    assert entry["source"] == "opt_out"
    assert (await api.get("/api/public/opt-out", params={"token": token})).json()["already_opted_out"] is True
    assert (await api.post("/api/public/opt-out", json={"token": token})).status_code == 200  # idempotent
    assert len(await sup.list_suppressions(uid)) == 1


async def test_opt_out_rejects_bad_tampered_and_login_tokens(api, signup):
    h, uid = await signup()
    assert (await api.get("/api/public/opt-out", params={"token": "x" * 30})).status_code == 400
    assert (await api.post("/api/public/opt-out", json={"token": "x" * 30})).status_code == 400
    good = optout.make_token(uid, "a@acme.com")
    assert (await api.post("/api/public/opt-out", json={"token": good[:-3] + "abc"})).status_code == 400
    login_token = h["Authorization"].split()[1]  # a real access token must not work as an opt-out token
    assert (await api.post("/api/public/opt-out", json={"token": login_token})).status_code == 400
    assert not await sup.is_suppressed(uid, "a@acme.com")


# ── erasure by email + audit log ─────────────────────────────────────────────

async def _seed_person(uid, email="jane@acme.com"):
    lead_id = await TABLES["leads"].insert({
        "request_id": "r-" + uid, "user_id": uid, "url": "https://acme.com", "title": "Acme", "email": email,
        "email_status": "likely", "provenance": {"email": {"source_url": "https://acme.com"}, "phone": {"source_url": "https://acme.com"}},
        "enrichment_status": "enriched",
    })
    await TABLES["lead_enrichments"].insert({"lead_id": lead_id, "contact_name": "Jane", "contact_title": "CTO", "buying_signals": "hiring"})
    dm_id = await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "Jane", "email": email})
    other_dm = await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "Bob", "email": "bob@acme.com"})
    return lead_id, dm_id, other_dm


async def test_erase_person_removes_data_suppresses_and_audits(db):
    lead_id, dm_id, other_dm = await _seed_person("o1")
    res = await erase_person_by_email("o1", "JANE@acme.com", actor_id="o1")
    assert res["decision_makers_deleted"] == 1 and res["leads_email_cleared"] == 1 and res["enrichments_cleared"] == 1

    assert await TABLES["decision_makers"].get(_id=dm_id) is None
    assert await TABLES["decision_makers"].get(_id=other_dm) is not None  # other people untouched
    lead = await TABLES["leads"].get(_id=lead_id)
    assert lead["email"] is None and lead["email_status"] is None and "email" not in lead["provenance"]
    assert "phone" in lead["provenance"] and lead["title"] == "Acme"  # company kept
    enr = await TABLES["lead_enrichments"].get(lead_id=lead_id)
    assert enr["contact_name"] is None and enr["buying_signals"] == "hiring"
    assert await sup.is_suppressed("o1", "jane@acme.com")

    log = await audit.list_entries("o1")
    assert len(log) == 1 and log[0]["action"] == "erase_person"
    d = log[0]["details"]
    assert d["decision_makers_deleted"] == 1 and d["subject_masked"] == "j***@acme.com"
    assert "jane@acme.com" not in str(log)  # the raw address is never logged
    assert d["subject_hash"] == audit.subject_hash("jane@acme.com")


async def test_erase_only_touches_the_owners_data(db):
    await _seed_person("o1")
    lead2, dm2, _ = await _seed_person("o2")
    await erase_person_by_email("o1", "jane@acme.com")
    assert await TABLES["decision_makers"].get(_id=dm2) is not None
    assert (await TABLES["leads"].get(_id=lead2))["email"] == "jane@acme.com"


async def test_erase_without_suppression_and_validation(db):
    await _seed_person("o1")
    res = await erase_person_by_email("o1", "jane@acme.com", add_to_suppression=False)
    assert res["suppressed"] is False and not await sup.is_suppressed("o1", "jane@acme.com")
    with pytest.raises(ValueError):
        await erase_person_by_email("o1", "acme.com")  # a domain is not a person


async def test_erase_api_and_audit_log_route(api, signup):
    h, uid = await signup()
    await _seed_person(uid)
    r = await api.post("/api/compliance/erase", headers=h, json={"email": "jane@acme.com"})
    assert r.status_code == 200 and r.json()["decision_makers_deleted"] == 1
    assert (await api.post("/api/compliance/erase", headers=h, json={"email": "acme.com"})).status_code == 400
    log = (await api.get("/api/compliance/audit-log", headers=h)).json()["items"]
    assert [e["action"] for e in log] == ["erase_person"] and log[0]["created_at"]
    h2, _ = await signup("z@t.com")
    assert (await api.get("/api/compliance/audit-log", headers=h2)).json()["items"] == []


async def test_new_decision_makers_for_erased_people_are_not_recollected(db):
    from app.db.leads import save_enriched_leads_to_db

    await sup.add_suppression("o1", "jane@acme.com", "", "erasure")
    item = {"company_name": "Acme", "source_url": "https://acme.com", "match_score": "70", "decision_makers": [
        {"name": "Jane", "email": "jane@acme.com", "linkedin_url": "https://linkedin.com/in/jane"},
        {"name": "Bob", "email": "bob@acme.com", "linkedin_url": "https://linkedin.com/in/bob"},
    ]}
    await save_enriched_leads_to_db("r", "o1", [item])
    names = [d["name"] for d in await TABLES["decision_makers"].find()]
    assert names == ["Bob"]


# ── retention ────────────────────────────────────────────────────────────────

NOW = datetime(2026, 6, 1)


async def _lead(owner, **kw):
    return await TABLES["leads"].insert({"request_id": "r", "user_id": owner, "url": f"https://{len(kw)}{owner}{kw.get('t','')}.com", "title": "L", **kw})


async def _lead_count():
    async with engine.read_session() as s, s.begin():
        return (await s.execute(select(func.count()).select_from(Lead))).scalar_one()


async def test_purge_deletes_rejected_expired_and_unpromoted_but_keeps_the_rest(db):
    old = NOW - timedelta(days=31)
    recent = NOW - timedelta(days=5)
    rejected_old = await _lead("o1", t="a", rejected_at=old, enrichment_status="enriched")
    rejected_new = await _lead("o1", t="b", rejected_at=recent, enrichment_status="enriched")
    expired = await _lead("o1", t="c", expires_at=NOW - timedelta(days=1), enrichment_status="enriched")
    not_expired = await _lead("o1", t="d", expires_at=NOW + timedelta(days=1), enrichment_status="enriched")
    unpromoted = await _lead("o1", t="e", created_at=old, enrichment_status="basic")
    fresh_basic = await _lead("o1", t="f", created_at=recent, enrichment_status="basic")
    good = await _lead("o1", t="g", created_at=old, enrichment_status="enriched")
    await TABLES["decision_makers"].insert({"lead_id": rejected_old, "name": "P", "email": "p@x.com"})

    res = await retention.purge_stale_leads(days=30, now=NOW)
    assert res["leads_deleted"] == 3 and res["by_reason"] == {"rejected": 1, "expired": 1, "unpromoted": 1}
    remaining = {l["_id"] for l in await TABLES["leads"].find()}
    assert remaining == {rejected_new, not_expired, fresh_basic, good}
    assert {rejected_old, expired, unpromoted}.isdisjoint(remaining)
    async with engine.read_session() as s, s.begin():
        assert (await s.execute(select(func.count()).select_from(DecisionMaker))).scalar_one() == 0
    assert (await audit.list_entries("o1"))[0]["action"] == "retention_purge"


async def test_purge_keeps_unpromoted_leads_that_are_in_a_list(db):
    from app.db import lead_lists as ll

    old = NOW - timedelta(days=40)
    lid = await _lead("o1", t="x", created_at=old, enrichment_status="basic")
    lst = await ll.create_lead_list("o1", "Keep")
    await ll.add_leads_to_list(lst["_id"], "o1", [lid])
    assert (await retention.purge_stale_leads(days=30, now=NOW))["leads_deleted"] == 0


async def test_purge_dry_run_and_owner_scope(db):
    old = NOW - timedelta(days=60)
    await _lead("o1", t="a", rejected_at=old)
    await _lead("o2", t="b", rejected_at=old)
    dry = await retention.purge_stale_leads(days=30, now=NOW, dry_run=True)
    assert dry["leads_deleted"] == 2 and dry["dry_run"] and await _lead_count() == 2
    await retention.purge_stale_leads(owner_id="o1", days=30, now=NOW)
    assert [l["user_id"] for l in await TABLES["leads"].find()] == ["o2"]


async def test_reject_restore_and_route_cycle(api, signup):
    h, uid = await signup()
    lead_id = await _lead(uid, t="r")
    other = await _lead("someone-else", t="s")
    assert (await api.post(f"/api/compliance/leads/{other}/reject", headers=h)).status_code == 404
    r = await api.post(f"/api/compliance/leads/{lead_id}/reject", headers=h)
    assert r.json() == {"rejected": True, "deleted_after_days": 30}
    assert (await TABLES["leads"].get(_id=lead_id))["rejected_at"]
    assert (await api.post(f"/api/compliance/leads/{lead_id}/restore", headers=h)).json() == {"rejected": False}
    assert (await TABLES["leads"].get(_id=lead_id))["rejected_at"] is None


async def test_retention_route_only_purges_callers_leads(api, signup):
    h, uid = await signup()
    mine = await _lead(uid, t="m", rejected_at=datetime.utcnow() - timedelta(days=45))
    theirs = await _lead("other", t="o", rejected_at=datetime.utcnow() - timedelta(days=45))
    dry = (await api.post("/api/compliance/retention/run", headers=h, params={"dry_run": "true"})).json()
    assert dry["leads_deleted"] == 1 and await TABLES["leads"].get(_id=mine)
    real = (await api.post("/api/compliance/retention/run", headers=h)).json()
    assert real["leads_deleted"] == 1
    assert await TABLES["leads"].get(_id=mine) is None and await TABLES["leads"].get(_id=theirs)


# ── exports: notice, status columns, suppression filtering ───────────────────

async def _export_fixture(api, signup):
    h, uid = await signup()
    rid = await TABLES["requests"].insert({"user_id": uid, "status": "Completed", "title": "T", "created_at": datetime.utcnow()})
    for name, email in (("Keep Co", "a@keep.com"), ("Drop Co", "b@drop.com"), ("Person Co", "p@person.com")):
        lid = await TABLES["leads"].insert({
            "request_id": rid, "user_id": uid, "title": name, "url": f"https://{name.split()[0].lower()}.com", "email": email,
            "enrichment_status": "enriched", "match_score": 80.0, "email_status": "risky",
            "email_checked_at": "2026-01-01T00:00:00+00:00", "provenance": {"email": {"source_url": f"https://{name.split()[0].lower()}.com/contact", "retrieved_at": "2026-01-01T00:00:00Z"}},
        })
        await TABLES["decision_makers"].insert({"lead_id": lid, "name": name + " Boss", "email": email, "email_status": "verified", "email_checked_at": "2026-02-02T00:00:00+00:00", "linkedin_url": "https://linkedin.com/in/" + name.split()[0].lower()})
    return h, uid, rid


def _rows(resp):
    return list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))


async def test_companies_csv_has_status_provenance_notice_and_drops_suppressed(api, signup, monkeypatch):
    from app.verification import local
    monkeypatch.setattr(local, "get_mx_records", lambda d: ["mx"])
    h, uid, rid = await _export_fixture(api, signup)
    await sup.add_suppression(uid, "drop.com", "", "manual")
    await sup.add_suppression(uid, "p@person.com", "", "manual")

    resp = await api.get(f"/api/leads/{rid}/export/companies", headers=h, params={"format": "csv"})
    assert resp.status_code == 200
    rows = _rows(resp)
    header = rows[0]
    for col in ("Email Status", "Email Checked At", "Field Sources"):
        assert col in header
    body = [r for r in rows[1:] if r and r[0] and not r[0].startswith("Source notice")]
    assert [r[0] for r in body] == ["Keep Co"]
    assert body[0][header.index("Email Status")] == "risky"
    assert "keep.com/contact" in body[0][header.index("Field Sources")]
    assert rows[-1][0].startswith("Source notice")


async def test_decision_makers_csv_filters_suppressed_and_includes_status(api, signup):
    h, uid, rid = await _export_fixture(api, signup)
    await sup.add_suppression(uid, "b@drop.com", "", "manual")
    rows = _rows(await api.get(f"/api/leads/{rid}/export/decision-makers", headers=h, params={"format": "csv"}))
    header = rows[0]
    people = [r for r in rows[1:] if r and not r[0].startswith("Source notice") and r[0]]
    assert sorted(r[header.index("Name")] for r in people) == ["Keep Co Boss", "Person Co Boss"]
    assert {r[header.index("Email Status")] for r in people} == {"verified"}
    assert all(r[header.index("Email Checked At")] for r in people)
    assert rows[-1][0].startswith("Source notice")


async def test_xlsx_export_carries_the_notice_on_its_own_sheet(api, signup):
    import openpyxl

    h, uid, rid = await _export_fixture(api, signup)
    resp = await api.get(f"/api/leads/{rid}/export/companies", headers=h, params={"format": "xlsx"})
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    assert "Source notice" in wb.sheetnames and wb["Source notice"]["A1"].value.startswith("Source notice")


async def test_list_export_filters_suppressed_and_adds_columns(api, signup):
    from app.db import lead_lists as ll

    h, uid, rid = await _export_fixture(api, signup)
    leads = await TABLES["leads"].find()
    lst = await ll.create_lead_list(uid, "L")
    await ll.add_leads_to_list(lst["_id"], uid, [l["_id"] for l in leads])
    await sup.add_suppression(uid, "keep.com", "", "manual")
    rows = _rows(await api.get(f"/api/lists/{lst['_id']}/export", headers=h, params={"format": "csv"}))
    header = rows[0]
    names = [r[0] for r in rows[1:] if r and r[0] and not r[0].startswith("Source notice")]
    assert sorted(names) == ["Drop Co", "Person Co"]
    assert "Email Status" in header and "Field Sources" in header
