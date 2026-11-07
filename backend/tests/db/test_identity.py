from datetime import datetime, timedelta

import httpx
import pytest

from app.db import organizations as orgs
from app.db import user_sessions as sessions
from app.db import users


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_register_duplicate_email_returns_400(api):
    body = {"email": "dup@example.com", "name": "Dup", "password": "Passw0rd!x", "org_name": "Acme", "org_domain": "acme.com"}
    first = await api.post("/api/auth/register", json=body)
    assert first.status_code == 201, first.text
    second = await api.post("/api/auth/register", json={**body, "org_domain": "other.com"})
    assert second.status_code == 400
    assert second.json()["detail"] == "Email already registered"


async def test_check_email_conflict_excludes_self(db):
    a_id, _ = await users.insert_user({"email": "a@example.com"})
    b_id, _ = await users.insert_user({"email": "b@example.com"})
    assert await users.check_email_conflict("a@example.com", a_id) is False
    assert await users.check_email_conflict("a@example.com", b_id) is True


async def test_find_user_by_google_or_email_matches_either(db):
    uid, _ = await users.insert_user({"email": "g@example.com", "google_id": "gid-1"})
    by_google = await users.find_user_by_google_or_email("gid-1", "nobody@example.com")
    by_email = await users.find_user_by_google_or_email("nope", "g@example.com")
    assert by_google["_id"] == uid and by_email["_id"] == uid
    assert await users.find_user_by_google_or_email("nope", "nobody@example.com") is None


async def test_get_session_ignores_expired(db):
    now = datetime.utcnow()
    await sessions.create_session("u1", "hash-old", now - timedelta(minutes=1))
    await sessions.create_session("u1", "hash-new", now + timedelta(days=1))
    assert await sessions.get_session_by_token_hash("hash-old") is None
    assert (await sessions.get_session_by_token_hash("hash-new"))["user_id"] == "u1"


async def test_purge_expired_sessions_deletes_only_expired(db):
    now = datetime.utcnow()
    await sessions.create_session("u1", "hash-old", now - timedelta(minutes=1))
    await sessions.create_session("u1", "hash-new", now + timedelta(days=1))
    assert await sessions.purge_expired_sessions() == 1
    assert (await sessions.get_session_by_token_hash("hash-new")) is not None


async def test_delete_sessions_for_user_only_that_user(db):
    exp = datetime.utcnow() + timedelta(days=1)
    await sessions.create_session("u1", "h1", exp)
    await sessions.create_session("u2", "h2", exp)
    await sessions.delete_sessions_for_user("u1")
    assert await sessions.get_session_by_token_hash("h1") is None
    assert await sessions.get_session_by_token_hash("h2") is not None


async def test_organization_domain_normalised_and_updatable(db):
    org = await orgs.create_organization("Acme", "  ACME.com ")
    assert org["domain"] == "acme.com"
    assert (await orgs.get_organization_by_domain("Acme.COM"))["_id"] == org["_id"]
    updated = await orgs.update_organization(org["_id"], {"name": "Acme Inc"})
    assert updated["name"] == "Acme Inc" and updated["domain"] == "acme.com"
    assert await orgs.get_organization_by_id("missing") is None


async def test_connect_db_purges_expired_sessions(db):
    from app.db import engine
    from app.db.models import TABLES

    await sessions.create_session("u1", "stale", datetime.utcnow() - timedelta(days=1))
    await engine.close_db()
    await engine.connect_db()  # same DATABASE_URL (file persists between connects)
    assert await TABLES["user_sessions"].get(token_hash="stale") is None
