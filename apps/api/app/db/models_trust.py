"""Tables for the data-trust and compliance features: suppression ledger, usage metering and the erasure audit log."""
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.docstore import DocTable
from app.db.models import TABLES, Base, _Doc, _s


class Suppression(_Doc, Base):
    """An email address or a whole domain that must never be contacted or exported for an owner."""

    __tablename__ = "suppressions"
    owner_id: Mapped[str | None] = _s()
    value: Mapped[str | None] = _s()  # lowercased email or domain
    kind: Mapped[str | None] = _s()  # "email" | "domain"
    __table_args__ = (UniqueConstraint("owner_id", "value", name="uq_suppression_owner_value"),)


class UsageEvent(_Doc, Base):
    """One metered action (a pipeline run, a sample run) with its call counts and estimated cost."""

    __tablename__ = "usage_events"
    user_id: Mapped[str | None] = _s()
    kind: Mapped[str | None] = _s()
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (Index("ix_usage_user_created", "user_id", "created_at"),)


class AuditLog(_Doc, Base):
    """Append-only record of compliance actions (erasures, retention purges). Holds no raw personal data."""

    __tablename__ = "audit_log"
    owner_id: Mapped[str | None] = _s(index=True)
    action: Mapped[str | None] = _s()
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


TABLES["suppressions"] = DocTable(Suppression)
TABLES["usage_events"] = DocTable(UsageEvent)
TABLES["audit_log"] = DocTable(AuditLog)
