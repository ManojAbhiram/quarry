import httpx
import pytest


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def signup(api):
    """signup(email) -> (auth headers, user id). Each user gets their own legacy org from registration."""

    async def _signup(email):
        body = {"email": email, "name": email.split("@")[0], "password": "Passw0rd!x",
                "org_name": "Org " + email, "org_domain": email.replace("@", ".") + ".test"}
        r = await api.post("/api/auth/register", json=body)
        assert r.status_code == 201, r.text
        j = r.json()
        return {"Authorization": f"Bearer {j['access_token']}"}, j["user"]["id"]

    return _signup


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    async def fake(*a, **k):
        return None

    monkeypatch.setattr("app.api.teams.send_invite_email", fake)
