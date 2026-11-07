import asyncio
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import TABLES


async def test_insert_and_get_roundtrip(db):
    users = TABLES["users"]
    payload = {
        "email": "a@example.com",
        "name": "Zürich 日本語",
        "prefs": {"tags": ["x", "y"], "nested": {"n": 1}},
        "blob": "x" * 1_000_000,
    }
    uid = await users.insert(dict(payload))
    got = await users.get(_id=uid)
    assert got["_id"] == uid
    for k, v in payload.items():
        assert got[k] == v


async def test_datetime_roundtrip_in_data(db):
    reqs = TABLES["requests"]
    when = datetime(2026, 11, 7, 12, 30, 45, 123456)
    rid = await reqs.insert({"user_id": "u1", "status": "Draft", "extra_time": when})
    assert (await reqs.get(_id=rid))["extra_time"] == when


async def test_update_merges_fields(db):
    users = TABLES["users"]
    uid = await users.insert({"email": "a@example.com", "name": "Ann", "plan": "free"})
    new = await users.update(uid, {"name": "Anna"})
    assert new["name"] == "Anna"
    assert new["plan"] == "free"
    assert new["email"] == "a@example.com"
    assert await users.update("missing-id", {"name": "x"}) is None


async def test_unique_violation_raises_integrity_error(db):
    users = TABLES["users"]
    await users.insert({"email": "dup@example.com"})
    with pytest.raises(IntegrityError):
        await users.insert({"email": "dup@example.com"})


async def test_two_null_urls_do_not_collide(db):
    leads = TABLES["leads"]
    await leads.insert({"request_id": "r1", "url": None, "title": "a"})
    await leads.insert({"request_id": "r1", "url": None, "title": "b"})
    assert len(await leads.find(leads.model.request_id == "r1")) == 2


async def test_25_concurrent_inserts_no_lock_errors(db):
    leads = TABLES["leads"]
    ids = await asyncio.gather(
        *[leads.insert({"request_id": "r1", "url": f"https://e{i}.com", "title": str(i)}) for i in range(25)]
    )
    assert len(set(ids)) == 25
