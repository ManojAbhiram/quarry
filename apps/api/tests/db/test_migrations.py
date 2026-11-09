import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db import migrations as mig
from app.db.models import Base

APP_DIR = Path(__file__).resolve().parents[2] / "app"


async def _engine(tmp_path):
    return create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'm.db'}")


async def _tables(eng):
    async with eng.begin() as c:
        return await c.run_sync(lambda x: set(inspect(x).get_table_names()))


async def test_fresh_db_gets_everything(tmp_path):
    eng = await _engine(tmp_path)
    assert await mig.run_migrations(eng) == [1]
    tables = await _tables(eng)
    assert set(Base.metadata.tables) <= tables and "schema_migrations" in tables
    assert await mig.current_version(eng) == 1
    async with eng.begin() as c:
        assert await c.run_sync(mig.schema_drift) == []
    await eng.dispose()


async def test_rerun_is_noop(tmp_path):
    eng = await _engine(tmp_path)
    await mig.run_migrations(eng)
    assert await mig.run_migrations(eng) == []
    await eng.dispose()


async def test_legacy_db_is_baselined_without_data_loss(tmp_path):
    """A database made by create_all (no schema_migrations table) keeps its rows."""
    path = tmp_path / "m.db"
    sync = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(sync)
    with sync.begin() as c:
        c.execute(text("INSERT INTO organizations (id, data) VALUES ('o1', '{\"name\": \"Acme\"}')"))
        c.execute(text("DROP TABLE credit_ledger"))  # an older DB that lacks a later table
    sync.dispose()
    eng = create_async_engine(f"sqlite+aiosqlite:///{path}")
    assert await mig.run_migrations(eng) == [1]
    async with eng.begin() as c:
        rows = (await c.execute(text("SELECT id FROM organizations"))).all()
    assert [tuple(r) for r in rows] == [("o1",)]
    assert "credit_ledger" in await _tables(eng)
    await eng.dispose()


async def test_older_version_runs_only_newer_migrations_and_adds_column(tmp_path):
    eng = await _engine(tmp_path)
    await mig.run_migrations(eng)
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO organizations (id, data) VALUES ('o1', '{}')"))

    calls = []

    def add_flag(conn):
        calls.append(1)
        mig.add_column(conn, "organizations", "flag", "VARCHAR", default="'x'")
        mig.add_column(conn, "organizations", "flag", "VARCHAR")  # idempotent

    migs = [*mig.MIGRATIONS, mig.Migration(2, "add flag", add_flag)]
    assert await mig.run_migrations(eng, migs) == [2]
    async with eng.begin() as c:
        assert (await c.execute(text("SELECT flag FROM organizations"))).scalar() == "x"
    assert await mig.run_migrations(eng, migs) == []
    assert calls == [1]
    assert await mig.current_version(eng) == 2
    await eng.dispose()


async def test_failed_migration_rolls_back(db):
    """Uses the app engine, which issues explicit BEGINs so SQLite DDL is transactional."""
    from app.db import engine

    eng = engine.engine

    def boom(conn):
        mig.add_column(conn, "organizations", "half", "VARCHAR")
        raise RuntimeError("nope")

    with pytest.raises(RuntimeError):
        await mig.run_migrations(eng, [*mig.MIGRATIONS, mig.Migration(2, "bad", boom)])
    assert await mig.current_version(eng) == 1
    async with eng.begin() as c:
        assert not await c.run_sync(lambda x: mig.has_column(x, "organizations", "half"))


def test_versions_must_be_consecutive():
    with pytest.raises(RuntimeError):
        mig._validate([mig.Migration(1, "a", lambda c: None), mig.Migration(3, "b", lambda c: None)])


async def test_drift_is_reported(tmp_path):
    eng = await _engine(tmp_path)
    await mig.run_migrations(eng)
    async with eng.begin() as c:
        await c.execute(text("DROP TABLE credit_ledger"))
        await c.execute(text("CREATE TABLE credit_ledger (id VARCHAR PRIMARY KEY)"))
        assert any("credit_ledger.scope_id" in p for p in await c.run_sync(mig.schema_drift))
    await eng.dispose()


def test_table_names_unique_across_modules():
    names = []
    for f in APP_DIR.rglob("*.py"):
        names += re.findall(r'__tablename__\s*=\s*"([^"]+)"', f.read_text(encoding="utf-8"))
    dupes = {n for n in names if names.count(n) > 1}
    assert not dupes, f"duplicate table names: {dupes}"
    import app.db.models as m

    assert set(names) == set(Base.metadata.tables)
    assert set(m.TABLES) <= set(names)


async def test_connect_db_runs_migrations(db):
    from app.db import engine

    assert await mig.current_version(engine.engine) == len(mig.MIGRATIONS)
