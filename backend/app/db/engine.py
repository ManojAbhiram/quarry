"""SQLAlchemy async engine + session factory for the SQLite database."""
import json
from datetime import datetime

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.logger import logger

engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _json_default(obj):
    if isinstance(obj, datetime):
        return {"$dt": obj.isoformat()}
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _json_hook(d: dict):
    if len(d) == 1 and "$dt" in d:
        return datetime.fromisoformat(d["$dt"])
    return d


def json_dumps(obj) -> str:
    return json.dumps(obj, default=_json_default, ensure_ascii=False)


def json_loads(s: str):
    return json.loads(s, object_hook=_json_hook)


async def connect_db() -> None:
    """Create the engine and any missing tables. Safe to call again after close_db()."""
    global engine, _sessionmaker
    from app.db.models import Base  # imported here: models -> docstore -> engine would be circular

    url = settings.DATABASE_URL
    logger.info("Opening database %s", url.split("///")[-1] if url.startswith("sqlite") else url.split("@")[-1])
    engine = create_async_engine(url, json_serializer=json_dumps, json_deserializer=json_loads)

    if url.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            # isolation_level=None + BEGIN IMMEDIATE (below): a transaction takes the write lock up front,
            # so concurrent writers queue on busy_timeout instead of failing with "database is locked".
            dbapi_conn.isolation_level = None
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

        @event.listens_for(engine.sync_engine, "begin")
        def _sqlite_begin(conn):
            conn.exec_driver_sql("BEGIN IMMEDIATE")

    _sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from app.db.user_sessions import purge_expired_sessions  # circular at import time, like Base above

    await purge_expired_sessions()
    logger.info("Database ready")


async def close_db() -> None:
    global engine, _sessionmaker
    if engine is not None:
        await engine.dispose()
        logger.info("Database closed")
    engine = None
    _sessionmaker = None


def session() -> AsyncSession:
    """Use as `async with session() as s, s.begin(): ...`."""
    if _sessionmaker is None:
        raise RuntimeError("Database not connected: call connect_db() first")
    return _sessionmaker()
