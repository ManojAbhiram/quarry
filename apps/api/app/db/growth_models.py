"""Phase 4 tables: teams, sharing and integrations. Registered on the shared Base/TABLES at import."""
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped

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
    "crm_connections": CrmConnection,
    "crm_sync": CrmSync,
    "webhook_subscriptions": WebhookSubscription,
}.items():
    TABLES[_name] = DocTable(_model)
