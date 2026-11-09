"""Fixtures for the Phase 2 tests: an HTTP client against the app and signed-up users."""
import httpx
import pytest


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def signup(api):
    async def _signup(email: str = "p2@t.com"):
        body = {
            "email": email, "name": "T", "password": "Passw0rd!x",
            "org_name": "Org", "org_domain": email.split("@")[0] + ".test",
        }
        r = await api.post("/api/auth/register", json=body)
        assert r.status_code == 201, r.text
        j = r.json()
        return {"Authorization": f"Bearer {j['access_token']}"}, j["user"]["id"]

    return _signup
