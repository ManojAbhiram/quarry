"""Phase 4 tables: teams, sharing, billing and integrations. Registered on the shared Base/TABLES at import."""
from datetime import datetime

from sqlalchemy import DateTime, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.docstore import DocTable
from app.db.models import TABLES, Base, _Doc, _s


class OrgMember(_Doc, Base):
    __tablename__ = "org_members"
    org_id: Mapped[str | None] = _s(index=True)
    user_id: Mapped[str | None] = _s(index=True)
    role: Mapped[str | None] = _s()
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_org_member"),)


class OrgInvite(_Doc, Base):
    __tablename__ = "org_invites"
    org_id: Mapped[str | None] = _s(index=True)
    email: Mapped[str | None] = _s(index=True)
    token_hash: Mapped[str | None] = _s(unique=True)
    status: Mapped[str | None] = _s()


class ResourceShare(_Doc, Base):
    __tablename__ = "resource_shares"
    org_id: Mapped[str | None] = _s(index=True)
    resource_type: Mapped[str | None] = _s()
    resource_id: Mapped[str | None] = _s()
    __table_args__ = (UniqueConstraint("org_id", "resource_type", "resource_id", name="uq_resource_share"),)


class Subscription(_Doc, Base):
    __tablename__ = "subscriptions"
    scope_id: Mapped[str | None] = _s(unique=True)
    provider_subscription_id: Mapped[str | None] = _s(index=True)


class CreditEntry(_Doc, Base):
    __tablename__ = "credit_ledger"
    scope_id: Mapped[str | None] = _s()
    kind: Mapped[str | None] = _s()
    ref: Mapped[str | None] = _s(unique=True)  # idempotency key (nullable)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (Index("ix_credit_scope_created", "scope_id", "created_at"),)


class BillingEvent(_Doc, Base):
    __tablename__ = "billing_events"
    event_key: Mapped[str | None] = _s(unique=True)  # "<provider>:<event_id>"


class Invoice(_Doc, Base):
    __tablename__ = "invoices"
    scope_id: Mapped[str | None] = _s(index=True)
    invoice_key: Mapped[str | None] = _s(unique=True)  # "<provider>:<invoice_id>"


class CrmConnection(_Doc, Base):
    __tablename__ = "crm_connections"
    scope_id: Mapped[str | None] = _s()
    provider: Mapped[str | None] = _s()
    __table_args__ = (UniqueConstraint("scope_id", "provider", name="uq_crm_scope_provider"),)


class CrmSync(_Doc, Base):
    __tablename__ = "crm_sync"
    connection_id: Mapped[str | None] = _s(index=True)
    lead_id: Mapped[str | None] = _s()
    __table_args__ = (UniqueConstraint("connection_id", "lead_id", name="uq_crm_sync_lead"),)


class WebhookSubscription(_Doc, Base):
    __tablename__ = "webhook_subscriptions"
    scope_id: Mapped[str | None] = _s(index=True)
    event: Mapped[str | None] = _s(index=True)


for _name, _model in {
    "org_members": OrgMember,
    "org_invites": OrgInvite,
    "resource_shares": ResourceShare,
    "subscriptions": Subscription,
    "credit_ledger": CreditEntry,
    "billing_events": BillingEvent,
    "invoices": Invoice,
    "crm_connections": CrmConnection,
    "crm_sync": CrmSync,
    "webhook_subscriptions": WebhookSubscription,
}.items():
    TABLES[_name] = DocTable(_model)
