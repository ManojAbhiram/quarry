"""SQLAlchemy async engine + session factory for the SQLite database."""
import asyncio
import json
from datetime import datetime

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.logger import logger

engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_read_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_write_lock: asyncio.Lock | None = None


class _WriteSession(AsyncSession):
    """A session that holds the process-wide write lock for the whole `async with` block.

    SQLite allows one writer at a time. Queueing writers on an asyncio.Lock (first come, first served) avoids
    relying on SQLite's sleep-and-retry busy handler, which is not fair and can time out under load.
    """

    async def __aenter__(self):
        await _write_lock.acquire()
        try:
            return await super().__aenter__()
        except BaseException:
            _write_lock.release()
            raise

    async def __aexit__(self, *exc_info):
        try:
            return await super().__aexit__(*exc_info)
        finally:
            _write_lock.release()


def _json_default(obj):
    if isinstance(obj, datetime):
        return {"$dt": obj.isoformat()}
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _json_hook(d: dict):
    if len(d) == 1 and "$dt" in d:
        try:
            return datetime.fromisoformat(d["$dt"])
        except (TypeError, ValueError):
            return d  # user data that merely looks like our marker: leave it alone
    return d


def json_dumps(obj) -> str:
    return json.dumps(obj, default=_json_default, ensure_ascii=False)


def json_loads(s: str):
    return json.loads(s, object_hook=_json_hook)


async def connect_db() -> None:
    """Create the engine and any missing tables. Safe to call again after close_db()."""
    global engine, _sessionmaker, _read_sessionmaker, _write_lock
    from app.db.models import Base  # imported here: models -> docstore -> engine would be circular

    url = settings.DATABASE_URL
    logger.info("Opening database %s", url.split("///")[-1] if url.startswith("sqlite") else url.split("@")[-1])
    engine = create_async_engine(url, json_serializer=json_dumps, json_deserializer=json_loads)

    if url.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):
            # isolation_level=None: we issue BEGIN ourselves (see _sqlite_begin below).
            dbapi_conn.isolation_level = None
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.close()

        @event.listens_for(engine.sync_engine, "begin")
        def _sqlite_begin(conn):
            # Writers take the write lock up front (IMMEDIATE); readers use a plain deferred transaction so WAL
            # lets them run alongside the single writer instead of queueing behind it.
            if conn.get_execution_options().get("read_only"):
                conn.exec_driver_sql("BEGIN")
            else:
                conn.exec_driver_sql("BEGIN IMMEDIATE")

    _write_lock = asyncio.Lock()
    _sessionmaker = async_sessionmaker(engine, class_=_WriteSession, expire_on_commit=False)
    _read_sessionmaker = async_sessionmaker(engine.execution_options(read_only=True), expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from app.db.user_sessions import purge_expired_sessions  # circular at import time, like Base above

    await purge_expired_sessions()
    logger.info("Database ready")


async def close_db() -> None:
    global engine, _sessionmaker, _read_sessionmaker, _write_lock
    if engine is not None:
        await engine.dispose()
        logger.info("Database closed")
    engine = None
    _sessionmaker = None
    _read_sessionmaker = None
    _write_lock = None


def session() -> AsyncSession:
    """Write session: `async with session() as s, s.begin(): ...`. Holds the write lock for the whole block."""
    if _sessionmaker is None:
        raise RuntimeError("Database not connected: call connect_db() first")
    return _sessionmaker()


def read_session() -> AsyncSession:
    """Read-only session (deferred transaction, no write lock). Do not write through it."""
    if _read_sessionmaker is None:
        raise RuntimeError("Database not connected: call connect_db() first")
    return _read_sessionmaker()
