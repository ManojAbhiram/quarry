"""HttpOnly cookie sessions, CSRF double-submit, Bearer fallback, and the removed X-User-Id bypass."""
import httpx
import pytest

from app.core.cookies import ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE

BODY = {"email": "c@t.com", "name": "C", "password": "Passw0rd!x", "org_name": "Org", "org_domain": "c.test"}


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _set_cookie_headers(resp):
    return resp.headers.get_list("set-cookie")


async def test_register_sets_httponly_session_cookies_and_readable_csrf(api):
    r = await api.post("/api/auth/register", json=BODY)
    assert r.status_code == 201
    cookies = {c.split("=", 1)[0]: c for c in _set_cookie_headers(r)}
    assert set(cookies) == {ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE}
    assert "httponly" in cookies[ACCESS_COOKIE].lower() and "samesite=lax" in cookies[ACCESS_COOKIE].lower()
    assert "httponly" in cookies[REFRESH_COOKIE].lower() and "path=/api/auth" in cookies[REFRESH_COOKIE].lower()
    assert "httponly" not in cookies[CSRF_COOKIE].lower()  # the SPA must be able to read it
    assert "secure" not in cookies[ACCESS_COOKIE].lower()  # default env is http://localhost


async def test_secure_flag_follows_settings(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    r = await api.post("/api/auth/register", json=BODY)
    assert all("secure" in c.lower() for c in _set_cookie_headers(r))


async def test_samesite_none_forces_secure(api, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "COOKIE_SAMESITE", "none")
    r = await api.post("/api/auth/login", json={"email": "x@y.com", "password": "nope-nope"})
    assert r.status_code == 401
    r = await api.post("/api/auth/register", json=BODY)
    assert all("secure" in c.lower() and "samesite=none" in c.lower() for c in _set_cookie_headers(r))


async def test_cookie_auth_works_for_get_and_requires_csrf_for_unsafe_methods(api):
    await api.post("/api/auth/register", json=BODY)
    assert api.cookies.get(ACCESS_COOKIE)
    assert (await api.get("/api/users/me")).status_code == 200  # cookie only, no Authorization header

    csrf = api.cookies.get(CSRF_COOKIE)
    no_header = await api.post("/api/lists", json={"name": "L"})
    assert no_header.status_code == 403 and "CSRF" in no_header.json()["detail"]
    wrong = await api.post("/api/lists", json={"name": "L"}, headers={CSRF_HEADER: "nope"})
    assert wrong.status_code == 403
    ok = await api.post("/api/lists", json={"name": "L"}, headers={CSRF_HEADER: csrf})
    assert ok.status_code in (200, 201)


async def test_bearer_header_needs_no_csrf_and_wins_over_cookie(api):
    r = await api.post("/api/auth/register", json=BODY)
    token = r.json()["access_token"]
    api.cookies.clear()
    ok = await api.post("/api/lists", json={"name": "L"}, headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code in (200, 201)


async def test_no_credentials_is_401(api):
    assert (await api.get("/api/users/me")).status_code == 401


async def test_x_user_id_header_no_longer_authenticates(api):
    r = await api.post("/api/auth/register", json=BODY)
    uid = r.json()["user"]["id"]
    api.cookies.clear()
    assert (await api.get("/api/users/me", headers={"X-User-Id": uid})).status_code == 401


async def test_refresh_token_cannot_be_used_as_access_token(api):
    r = await api.post("/api/auth/register", json=BODY)
    api.cookies.clear()
    bad = await api.get("/api/users/me", headers={"Authorization": f"Bearer {r.json()['refresh_token']}"})
    assert bad.status_code == 401


async def test_refresh_via_cookie_rotates_session_and_needs_csrf(api):
    await api.post("/api/auth/register", json=BODY)
    old_refresh = api.cookies.get(REFRESH_COOKIE, path="/api/auth")
    assert (await api.post("/api/auth/refresh")).status_code == 403  # cookie credential, no CSRF header
    csrf = api.cookies.get(CSRF_COOKIE)
    r = await api.post("/api/auth/refresh", headers={CSRF_HEADER: csrf})
    assert r.status_code == 200
    assert ACCESS_COOKIE in "".join(_set_cookie_headers(r))
    assert api.cookies.get(REFRESH_COOKIE, path="/api/auth") != old_refresh
    # the rotated-out token is dead
    again = await api.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert again.status_code == 401


async def test_refresh_with_body_token_still_works_for_api_clients(api):
    r = await api.post("/api/auth/register", json=BODY)
    api.cookies.clear()
    out = await api.post("/api/auth/refresh", json={"refresh_token": r.json()["refresh_token"]})
    assert out.status_code == 200 and out.json()["access_token"]


async def test_refresh_without_any_token_is_401(api):
    assert (await api.post("/api/auth/refresh")).status_code == 401


async def test_logout_clears_cookies_and_kills_the_session(api):
    await api.post("/api/auth/register", json=BODY)
    refresh = api.cookies.get(REFRESH_COOKIE, path="/api/auth")
    r = await api.post("/api/auth/logout")
    assert r.status_code == 204
    cleared = _set_cookie_headers(r)
    assert len(cleared) == 3 and all("max-age=0" in c.lower() for c in cleared)
    dead = await api.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert dead.status_code == 401


async def test_csrf_endpoint_returns_cookie_value(api):
    await api.post("/api/auth/register", json=BODY)
    r = await api.get("/api/auth/csrf")
    assert r.json()["csrf_token"] == api.cookies.get(CSRF_COOKIE)


async def test_google_redirect_flow_keeps_tokens_out_of_the_url(api, monkeypatch):
    import httpx as real_httpx

    from app.api import google_auth

    class FakeResp:
        def __init__(self, code, data):
            self.status_code, self._d, self.text = code, data, ""

        def json(self):
            return self._d

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return FakeResp(200, {"access_token": "g"})

        async def get(self, *a, **k):
            return FakeResp(200, {"sub": "gid1", "email": "g@t.com", "name": "G"})

    monkeypatch.setattr(google_auth.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    assert real_httpx.AsyncClient is not None
    r = await api.get("/api/auth/google/callback", params={"code": "abc"}, follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert "access_token" not in loc and "refresh_token" not in loc and "login=success" in loc
    assert ACCESS_COOKIE in "".join(_set_cookie_headers(r))
    assert (await api.get("/api/users/me")).status_code == 200


def test_only_one_google_callback_route_is_registered():
    from app.main import app

    paths = {p: sorted(ops) for p, ops in app.openapi()["paths"].items() if "google/callback" in p}
    assert paths == {"/api/auth/google/callback": ["get"]}
