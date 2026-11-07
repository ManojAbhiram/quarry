"""Edge cases found in the final review of the SQLite migration."""
import httpx
import pytest

from app.db import lead_lists as ll
from app.db.models import TABLES


async def test_user_json_that_mimics_the_datetime_marker_does_not_break_reads(db):
    intake = TABLES["product_intake"]
    row_id = await intake.insert({"request_id": "q", "answers": {"$dt": "not a date"}})
    assert (await intake.get(_id=row_id))["answers"] == {"$dt": "not a date"}


async def test_add_leads_to_a_list_deleted_midway_returns_none(db, monkeypatch):
    await TABLES["leads"].insert({"_id": "l1", "request_id": "r", "user_id": "u1", "url": "https://l1.example.com"})
    lst = await ll.create_lead_list("u1", "A")
    ghost = dict(await TABLES["lead_lists"].get(_id=lst["_id"]))
    await TABLES["lead_lists"].delete(lst["_id"])
    real_get = TABLES["lead_lists"].get

    async def stale_get(**eq):  # the ownership check still "sees" the list, as in a race
        return ghost if eq.get("_id") == lst["_id"] else await real_get(**eq)

    monkeypatch.setattr(TABLES["lead_lists"], "get", stale_get)
    assert await ll.add_leads_to_list(lst["_id"], "u1", ["l1"]) is None


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_concurrent_duplicate_signup_returns_400_not_500(api, monkeypatch):
    body = {"email": "race@example.com", "name": "R", "password": "Passw0rd!x", "org_name": "R", "org_domain": "race.com"}
    assert (await api.post("/api/auth/register", json=body)).status_code == 201

    async def no_precheck(_email):  # simulates losing the race: the pre-check saw no user yet
        return None

    monkeypatch.setattr("app.api.auth.get_user_by_email", no_precheck)
    resp = await api.post("/api/auth/register", json={**body, "org_domain": "other.com"})
    assert resp.status_code == 400, resp.text
    assert "already registered" in resp.json()["detail"]
