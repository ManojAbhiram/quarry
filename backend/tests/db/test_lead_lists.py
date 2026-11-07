import httpx
from sqlalchemy import func, select

from app.db import engine, leads
from app.db import lead_lists as ll
from app.db.models import TABLES, Lead, LeadListItem


async def _item_count():
    async with engine.session() as s, s.begin():
        return (await s.execute(select(func.count()).select_from(LeadListItem))).scalar_one()


async def test_create_list_returns_empty_lead_ids(db):
    doc = await ll.create_lead_list("u1", "Hot", color="#fff", description="d")
    assert doc["lead_ids"] == [] and doc["name"] == "Hot" and doc["_id"]
    assert (await ll.get_lead_list_by_id(doc["_id"], "u1"))["lead_ids"] == []


async def test_add_leads_to_list_is_idempotent_and_ordered(db):
    lst = await ll.create_lead_list("u1", "A")
    await ll.add_leads_to_list(lst["_id"], "u1", ["l3", "l1"])
    got = await ll.add_leads_to_list(lst["_id"], "u1", ["l1", "l2"])
    assert got["lead_ids"] == ["l3", "l1", "l2"]


async def test_remove_leads_from_list(db):
    lst = await ll.create_lead_list("u1", "A")
    await ll.add_leads_to_list(lst["_id"], "u1", ["l1", "l2", "l3"])
    got = await ll.remove_leads_from_list(lst["_id"], "u1", ["l2", "not-in-list"])
    assert got["lead_ids"] == ["l1", "l3"]


async def test_lead_in_multiple_lists_reverse_lookup(db):
    a = await ll.create_lead_list("u1", "A")
    b = await ll.create_lead_list("u1", "B")
    other = await ll.create_lead_list("u2", "C")
    for lst, uid in ((a, "u1"), (b, "u1"), (other, "u2")):
        await ll.add_leads_to_list(lst["_id"], uid, ["shared"])
    mine = await ll.get_lists_for_lead("shared", "u1")
    assert {d["_id"] for d in mine} == {a["_id"], b["_id"]}
    assert all(d["lead_ids"] == ["shared"] for d in mine)
    assert await ll.get_lists_for_lead("nobody", "u1") == []


async def test_delete_lead_list_removes_memberships(db):
    lst = await ll.create_lead_list("u1", "A")
    keep = await ll.create_lead_list("u1", "B")
    await ll.add_leads_to_list(lst["_id"], "u1", ["l1", "l2"])
    await ll.add_leads_to_list(keep["_id"], "u1", ["l1"])
    assert await ll.delete_lead_list(lst["_id"], "u1") is True
    assert await ll.delete_lead_list(lst["_id"], "u1") is False
    assert await _item_count() == 1
    assert (await ll.get_lead_list_by_id(keep["_id"], "u1"))["lead_ids"] == ["l1"]


async def test_get_lead_lists_for_user_sorted_newest_first(db):
    first = await ll.create_lead_list("u1", "first")
    second = await ll.create_lead_list("u1", "second")
    await ll.create_lead_list("u2", "theirs")
    await ll.add_leads_to_list(first["_id"], "u1", ["l1"])
    got = await ll.get_lead_lists_for_user("u1")
    assert [d["name"] for d in got] == ["second", "first"]
    assert got[1]["lead_ids"] == ["l1"] and got[0]["lead_ids"] == []
    assert second["_id"] == got[0]["_id"]


async def test_lists_are_scoped_per_user(db):
    lst = await ll.create_lead_list("u1", "A")
    assert await ll.get_lead_list_by_id(lst["_id"], "u2") is None
    assert await ll.update_lead_list(lst["_id"], "u2", {"name": "x"}) is None
    assert await ll.add_leads_to_list(lst["_id"], "u2", ["l1"]) is None
    assert await ll.remove_leads_from_list(lst["_id"], "u2", ["l1"]) is None
    assert await ll.delete_lead_list(lst["_id"], "u2") is False


async def test_update_lead_list_changes_fields_but_not_membership(db):
    lst = await ll.create_lead_list("u1", "A")
    await ll.add_leads_to_list(lst["_id"], "u1", ["l1"])
    got = await ll.update_lead_list(lst["_id"], "u1", {"name": "B", "lead_ids": ["hack"]})
    assert got["name"] == "B" and got["lead_ids"] == ["l1"]


async def test_get_leads_by_ids(db):
    await leads.process_and_save_standalone_leads(
        [{"title": "A", "url": "https://a.com"}, {"title": "B", "url": "https://b.com"}], "r1", "u1"
    )
    assert await leads.get_leads_by_ids([]) == []
    first = (await TABLES["leads"].find(order_by=Lead.url))[0]
    got = await leads.get_leads_by_ids([first["_id"], "missing"])
    assert [r["_id"] for r in got] == [first["_id"]]


async def test_list_endpoints_use_membership(db):
    from app.main import app
    from app.services.auth import get_current_user

    await leads.process_and_save_standalone_leads([{"title": "Acme", "url": "https://acme.com"}], "r1", "u1")
    lead_id = (await TABLES["leads"].find())[0]["_id"]
    lst = await ll.create_lead_list("u1", "A")
    await ll.add_leads_to_list(lst["_id"], "u1", [lead_id, "ghost-lead"])
    app.dependency_overrides[get_current_user] = lambda: {"_id": "u1", "email": "x@y.z"}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            detail = await c.get(f"/api/lists/{lst['_id']}")
            export = await c.get(f"/api/lists/{lst['_id']}/export?format=csv")
    finally:
        app.dependency_overrides.clear()
    assert detail.status_code == 200, detail.text
    assert [x["title"] for x in detail.json()["leads"]] == ["Acme"]
    assert export.status_code == 200 and "Acme" in export.text and "ghost-lead" not in export.text
