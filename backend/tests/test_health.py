"""Smoke tests: the app imports, wires up, and serves /api/health.

These are intentionally shallow: they catch an import error, a bad route prefix, or a
broken health endpoint before it ships.
"""


def test_health_returns_ok(client):
    """The health endpoint must return 200."""
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["project"] == "Quarry API"
    assert "version" in body


def test_health_path_is_stable():
    """Clients and monitors rely on /api/health; changing API_V1_STR would silently move it."""
    from app.core.config import settings

    assert f"{settings.API_V1_STR}/health" == "/api/health"


def test_app_exposes_expected_routes(client):
    """Catch accidental removal of a whole router during a refactor.

    Walking `app.routes` is deliberately avoided: FastAPI 0.141 / Starlette 1.3
    wrap `include_router()` results in `_IncludedRouter` objects that expose
    neither `.path` nor `.routes` (they hold `.original_router`), so recursing
    over internals is version-fragile. The generated OpenAPI schema is public,
    stable API and lists every registered path.
    """
    paths = set(client.app.openapi()["paths"].keys())

    assert "/api/health" in paths
    # Representative paths from the core routers.
    assert any(p.startswith("/api/auth") for p in paths), f"auth router missing from {sorted(paths)[:10]}"
    assert any(p.startswith("/api/leads") for p in paths), "leads router missing"
    assert any(p.startswith("/api/users") for p in paths), "users router missing"


def test_cors_configured():
    """ALLOWED_ORIGINS must parse into a non-empty list.

    An empty list would silently block the browser frontend in production.
    """
    from app.core.config import settings

    assert isinstance(settings.ALLOWED_ORIGINS, list)
    assert len(settings.ALLOWED_ORIGINS) > 0
    assert all(o.strip() for o in settings.ALLOWED_ORIGINS)
