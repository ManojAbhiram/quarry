"""Small versioned schema migration runner.

`create_all` only creates missing tables; it never alters existing ones. This runner applies ordered, numbered
migrations exactly once and records them in the `schema_migrations` table. It runs at startup (see
`engine.connect_db`) before the app serves anything, and is idempotent: re-running applies nothing.

Version 1 is the baseline. It runs `create_all`, so a fresh database gets every table and an existing database
(created by older code with `create_all`) keeps all of its data and only gains tables it was missing.

To add a migration see "Schema migrations" in apps/api/README.md. In short: append a `Migration` to `MIGRATIONS`
with the next version number and a function taking a sync SQLAlchemy `Connection`.
"""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, MetaData, String, Table, inspect, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.logger import logger

_meta = MetaData()
schema_migrations = Table(
    "schema_migrations",
    _meta,
    Column("version", Integer, primary_key=True, autoincrement=False),
    Column("name", String, nullable=False),
    Column("applied_at", String, nullable=False),
)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    apply: Callable[[Connection], None]


# -- helpers for migration authors ---------------------------------------------------------------------------------
def create_tables(conn: Connection, *table_names: str) -> None:
    """Create the named tables (from the ORM metadata) if they do not exist yet."""
    from app.db.models import Base

    tables = [Base.metadata.tables[n] for n in table_names]
    Base.metadata.create_all(conn, tables=tables, checkfirst=True)


def has_column(conn: Connection, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspect(conn).get_columns(table))


def add_column(conn: Connection, table: str, column: str, ddl_type: str, default: str | None = None) -> None:
    """ALTER TABLE ... ADD COLUMN, skipped when the column already exists (safe to re-run).

    `ddl_type` is a literal SQL type such as "VARCHAR" or "INTEGER"; `default` a literal SQL default such as "'x'".
    Table/column names are identifiers from code, never user input.
    """
    if has_column(conn, table, column):
        return
    ddl = f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl_type}'
    if default is not None:
        ddl += f" DEFAULT {default}"
    conn.execute(text(ddl))


# -- migrations ----------------------------------------------------------------------------------------------------
def _baseline(conn: Connection) -> None:
    from app.db.models import Base

    Base.metadata.create_all(conn)


MIGRATIONS: list[Migration] = [
    Migration(1, "baseline: create all tables that do not exist", _baseline),
]


def _validate(migrations: list[Migration]) -> None:
    versions = [m.version for m in migrations]
    if versions != list(range(1, len(versions) + 1)):
        raise RuntimeError(f"Migration versions must be consecutive starting at 1, got {versions}")


def _migrate(conn: Connection, migrations: list[Migration]) -> list[int]:
    _validate(migrations)
    _meta.create_all(conn, tables=[schema_migrations], checkfirst=True)
    applied = set(conn.execute(select(schema_migrations.c.version)).scalars())
    ran: list[int] = []
    for m in migrations:
        if m.version in applied:
            continue
        logger.info("Applying migration %d: %s", m.version, m.name)
        m.apply(conn)
        conn.execute(
            schema_migrations.insert().values(
                version=m.version, name=m.name, applied_at=datetime.now(timezone.utc).isoformat()
            )
        )
        ran.append(m.version)
    return ran


def schema_drift(conn: Connection) -> list[str]:
    """Columns declared by the models but missing in the database (a migration is probably missing)."""
    from app.db.models import Base

    insp = inspect(conn)
    problems = []
    for name, table in Base.metadata.tables.items():
        if not insp.has_table(name):
            problems.append(f"table {name} is missing")
            continue
        have = {c["name"] for c in insp.get_columns(name)}
        problems += [f"{name}.{c.name} is missing" for c in table.columns if c.name not in have]
    return problems


async def run_migrations(engine: AsyncEngine, migrations: list[Migration] | None = None) -> list[int]:
    """Apply pending migrations in one transaction; returns the versions applied (empty when up to date)."""
    migs = MIGRATIONS if migrations is None else migrations
    async with engine.begin() as conn:
        ran = await conn.run_sync(_migrate, migs)
        drift = await conn.run_sync(schema_drift)
    for p in drift:
        logger.warning("Schema drift: %s. Add a migration (see apps/api/README.md).", p)
    return ran


async def current_version(engine: AsyncEngine) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(select(schema_migrations.c.version))
        return max((r[0] for r in result), default=0)
