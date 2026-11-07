"""Shared pytest fixtures and environment setup.

IMPORTANT: app.core.config instantiates `Settings()` at module import time, and
`_require()` raises EnvironmentError when SECRET_KEY or SERPER_API_KEY are missing.
That means *merely importing* anything under `app.` explodes unless those vars are
set. They are seeded here, before any test module is imported, so collection works
in CI without real credentials.

These are throwaway values. Nothing here reaches a real external service: the tests
below never trigger the FastAPI lifespan hook, so `connect_db()` is never called and
no MongoDB instance is needed.
"""

import os

# Must run before `app.*` is imported anywhere. pytest imports conftest first.
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production-0123456789")
os.environ.setdefault("SERPER_API_KEY", "test-serper-key")
os.environ.setdefault("MONGODB_URL", "mongodb://localhost:27017/quarry_test?authSource=admin")
os.environ.setdefault("DATABASE_NAME", "quarry_test")
# Keep Chromium out of CI runs entirely.
os.environ.setdefault("ENABLE_PLAYWRIGHT", "false")

import pytest  # noqa: E402


@pytest.fixture
def client():
    """A TestClient that does NOT run startup/shutdown events.

    Instantiating TestClient as a context manager would fire the lifespan hook and
    attempt a real MongoDB connection. Constructing it directly skips lifespan, so
    these stay true unit tests with no database dependency.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
