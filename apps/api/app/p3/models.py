"""Phase 3 tables. Registered into the shared TABLES map by an import at the bottom of app/db/models.py."""
from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.docstore import DocTable
from app.db.models import TABLES, Base, _Doc, _s


def _dt(**kw):
    return mapped_column(DateTime, nullable=True, **kw)


class OutreachMailbox(_Doc, Base):
    __tablename__ = "outreach_mailboxes"
    user_id: Mapped[str | None] = _s(index=True)


class OutreachSequence(_Doc, Base):
    __tablename__ = "outreach_sequences"
    user_id: Mapped[str | None] = _s(index=True)
    status: Mapped[str | None] = _s()


class OutreachEnrollment(_Doc, Base):
    __tablename__ = "outreach_enrollments"
    sequence_id: Mapped[str | None] = _s(index=True)
    user_id: Mapped[str | None] = _s(index=True)
    status: Mapped[str | None] = _s()
    email: Mapped[str | None] = _s()
    next_send_at: Mapped[datetime | None] = _dt()
    __table_args__ = (Index("ix_enroll_due", "status", "next_send_at"),)


class OutreachMessage(_Doc, Base):
    __tablename__ = "outreach_messages"
    enrollment_id: Mapped[str | None] = _s(index=True)
    mailbox_id: Mapped[str | None] = _s(index=True)
    message_id: Mapped[str | None] = _s(index=True)
    direction: Mapped[str | None] = _s()  # out | reply | bounce
    created_at: Mapped[datetime | None] = _dt()


class ApiKey(_Doc, Base):
    __tablename__ = "api_keys"
    user_id: Mapped[str | None] = _s(index=True)
    key_hash: Mapped[str | None] = _s(unique=True)


class Webhook(_Doc, Base):
    __tablename__ = "webhooks"
    user_id: Mapped[str | None] = _s(index=True)


class WebhookDelivery(_Doc, Base):
    __tablename__ = "webhook_deliveries"
    webhook_id: Mapped[str | None] = _s(index=True)
    status: Mapped[str | None] = _s()  # pending | delivered | failed
    next_attempt_at: Mapped[datetime | None] = _dt()


class SavedSearch(_Doc, Base):
    __tablename__ = "saved_searches"
    user_id: Mapped[str | None] = _s(index=True)


class SignalEvent(_Doc, Base):
    __tablename__ = "signal_events"
    user_id: Mapped[str | None] = _s(index=True)
    domain: Mapped[str | None] = _s(index=True)
    kind: Mapped[str | None] = _s()
    detected_at: Mapped[datetime | None] = _dt()


class WatchSnapshot(_Doc, Base):
    __tablename__ = "watch_snapshots"
    snapshot_key: Mapped[str | None] = _s(unique=True)


class CreditLedger(_Doc, Base):
    __tablename__ = "credit_ledger"
    user_id: Mapped[str | None] = _s(index=True)
    created_at: Mapped[datetime | None] = _dt()


class ProviderKey(_Doc, Base):
    __tablename__ = "provider_keys"
    user_id: Mapped[str | None] = _s(index=True)
    provider: Mapped[str | None] = _s()


class FallbackSuppression(_Doc, Base):
    """Used only by the fallback in app.outreach.deps until Phase 2's suppression ledger exists."""

    __tablename__ = "fallback_suppressions"
    owner_id: Mapped[str | None] = _s(index=True)
    value: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


TABLES.update({
    "outreach_mailboxes": DocTable(OutreachMailbox),
    "outreach_sequences": DocTable(OutreachSequence),
    "outreach_enrollments": DocTable(OutreachEnrollment),
    "outreach_messages": DocTable(OutreachMessage),
    "api_keys": DocTable(ApiKey),
    "webhooks": DocTable(Webhook),
    "webhook_deliveries": DocTable(WebhookDelivery),
    "saved_searches": DocTable(SavedSearch),
    "signal_events": DocTable(SignalEvent),
    "watch_snapshots": DocTable(WatchSnapshot),
    "credit_ledger": DocTable(CreditLedger),
    "provider_keys": DocTable(ProviderKey),
    "fallback_suppressions": DocTable(FallbackSuppression),
})
