"""Generic document<->row mapping used by every repository module.

A table has an `id` string primary key, a few real "key" columns (filtered, joined, sorted or unique),
and a `data` JSON column holding every other field. Documents are flat dicts that always carry `_id`.
"""
import uuid
from typing import Any, Optional

from sqlalchemy import delete, select

from app.db import engine as _engine

_ID = "_id"


class DocTable:
    def __init__(self, model):
        self.model = model
        self.key_columns = [c.name for c in model.__table__.columns if c.name not in ("id", "data")]

    # -- mapping -----------------------------------------------------------
    def _split(self, doc: dict) -> tuple[dict, dict]:
        keys = {k: v for k, v in doc.items() if k in self.key_columns}
        data = {k: v for k, v in doc.items() if k != _ID and k not in self.key_columns}
        return keys, data

    def _to_doc(self, row) -> dict:
        doc = {_ID: row.id}
        doc.update(row.data or {})
        for k in self.key_columns:
            doc[k] = getattr(row, k)
        return doc

    def _eq(self, eq: dict) -> list:
        conds = []
        for k, v in eq.items():
            col = self.model.id if k == _ID else getattr(self.model, k)
            conds.append(col == v)
        return conds

    def _apply(self, row, fields: dict) -> None:
        keys, data = self._split(fields)
        for k, v in keys.items():
            setattr(row, k, v)
        if data:
            row.data = {**(row.data or {}), **data}

    # -- operations --------------------------------------------------------
    async def insert(self, doc: dict) -> str:
        new_id = str(doc.get(_ID) or uuid.uuid4())
        keys, data = self._split(doc)
        async with _engine.session() as s, s.begin():
            s.add(self.model(id=new_id, data=data, **keys))
        return new_id

    async def get(self, **eq) -> Optional[dict]:
        async with _engine.read_session() as s, s.begin():
            row = (await s.execute(select(self.model).where(*self._eq(eq)).limit(1))).scalars().first()
            return self._to_doc(row) if row else None

    async def find(self, *where, order_by=None, limit: Optional[int] = None) -> list[dict]:
        stmt = select(self.model).where(*where)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        async with _engine.read_session() as s, s.begin():
            return [self._to_doc(r) for r in (await s.execute(stmt)).scalars().all()]

    async def update(self, id: str, fields: dict) -> Optional[dict]:
        async with _engine.session() as s, s.begin():
            row = await s.get(self.model, id)
            if row is None:
                return None
            self._apply(row, fields)
            return self._to_doc(row)

    async def replace(self, id: str, doc: dict) -> Optional[dict]:
        """Overwrite the whole document: fields absent from `doc` are dropped (key columns become NULL)."""
        keys, data = self._split(doc)
        async with _engine.session() as s, s.begin():
            row = await s.get(self.model, id)
            if row is None:
                return None
            for k in self.key_columns:
                setattr(row, k, keys.get(k))
            row.data = data
            return self._to_doc(row)

    async def modify(self, id: str, fn) -> Optional[dict]:
        """Read-modify-write in one transaction: `fn(doc) -> fields to set`. Atomic under SQLite's write lock."""
        async with _engine.session() as s, s.begin():
            row = await s.get(self.model, id)
            if row is None:
                return None
            self._apply(row, fn(self._to_doc(row)))
            return self._to_doc(row)

    async def upsert(self, match: dict, doc: dict) -> str:
        async with _engine.session() as s, s.begin():
            row = (await s.execute(select(self.model).where(*self._eq(match)).limit(1))).scalars().first()
            if row is not None:
                self._apply(row, doc)
                return row.id
            full: dict[str, Any] = {**match, **doc}
            keys, data = self._split(full)
            new_id = str(full.get(_ID) or uuid.uuid4())
            s.add(self.model(id=new_id, data=data, **keys))
            return new_id

    async def delete(self, id: str) -> bool:
        async with _engine.session() as s, s.begin():
            res = await s.execute(delete(self.model).where(self.model.id == id))
            return res.rowcount > 0

    async def delete_where(self, *where) -> int:
        async with _engine.session() as s, s.begin():
            res = await s.execute(delete(self.model).where(*where))
            return res.rowcount
