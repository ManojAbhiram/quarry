"""SQLAlchemy models: one table per document collection (see docstore.DocTable for the mapping)."""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.docstore import DocTable


class Base(DeclarativeBase):
    pass


class _Doc:
    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


def _s(**kw):
    return mapped_column(String, nullable=True, **kw)


class Organization(_Doc, Base):
    __tablename__ = "organizations"
    domain: Mapped[str | None] = _s(unique=True)


class User(_Doc, Base):
    __tablename__ = "users"
    email: Mapped[str | None] = _s(unique=True)
    google_id: Mapped[str | None] = _s(unique=True)
    org_id: Mapped[str | None] = _s(index=True)


class UserSession(_Doc, Base):
    __tablename__ = "user_sessions"
    user_id: Mapped[str | None] = _s(index=True)
    token_hash: Mapped[str | None] = _s(unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class Request(_Doc, Base):
    __tablename__ = "requests"
    user_id: Mapped[str | None] = _s()
    org_id: Mapped[str | None] = _s()
    status: Mapped[str | None] = _s(index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        Index("ix_requests_user_created", "user_id", "created_at"),
        Index("ix_requests_org_created", "org_id", "created_at"),
    )


class ProductIntake(_Doc, Base):
    __tablename__ = "product_intake"
    request_id: Mapped[str | None] = _s(unique=True)


class IcpProfile(_Doc, Base):
    __tablename__ = "icp_profiles"
    request_id: Mapped[str | None] = _s(unique=True)


class CompetitorAnalysis(_Doc, Base):
    __tablename__ = "competitor_analyses"
    request_id: Mapped[str | None] = _s(unique=True)
    user_id: Mapped[str | None] = _s(index=True)
    status: Mapped[str | None] = _s(index=True)


class Competitor(_Doc, Base):
    __tablename__ = "competitors"
    analysis_id: Mapped[str | None] = _s()
    url: Mapped[str | None] = _s()
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    __table_args__ = (
        UniqueConstraint("analysis_id", "url", name="uq_competitor_analysis_url"),
        Index("ix_competitors_analysis_score", "analysis_id", "match_score"),
    )


class Lead(_Doc, Base):
    __tablename__ = "leads"
    request_id: Mapped[str | None] = _s()
    user_id: Mapped[str | None] = _s(index=True)
    url: Mapped[str | None] = _s()
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    enrichment_status: Mapped[str | None] = _s()
    __table_args__ = (
        UniqueConstraint("request_id", "url", name="uq_lead_request_url"),
        Index("ix_leads_request_score", "request_id", "match_score"),
    )


class LeadEnrichment(_Doc, Base):
    __tablename__ = "lead_enrichments"
    lead_id: Mapped[str | None] = _s(unique=True)
    company_id: Mapped[str | None] = _s(index=True)


class DecisionMaker(_Doc, Base):
    __tablename__ = "decision_makers"
    lead_id: Mapped[str | None] = _s(index=True)
    

class Company(_Doc, Base):
    __tablename__ = "companies"
    canonical_domain: Mapped[str | None] = _s(unique=True)
    crunchbase_id: Mapped[str | None] = _s(unique=True)
    linkedin_id: Mapped[str | None] = _s(unique=True)


class LeadList(_Doc, Base):
    __tablename__ = "lead_lists"
    user_id: Mapped[str | None] = _s()
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (Index("ix_lead_lists_user_created", "user_id", "created_at"),)


class LeadListItem(Base):
    """Membership of a lead in a list (one row per lead in a list)."""

    __tablename__ = "lead_list_items"
    list_id: Mapped[str] = mapped_column(ForeignKey("lead_lists.id", ondelete="CASCADE"), primary_key=True)
    lead_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)  # preserves list order


class SerperCache(_Doc, Base):
    __tablename__ = "serper_cache"
    query: Mapped[str | None] = _s(unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


TABLES: dict[str, DocTable] = {
    "organizations": DocTable(Organization),
    "users": DocTable(User),
    "user_sessions": DocTable(UserSession),
    "requests": DocTable(Request),
    "product_intake": DocTable(ProductIntake),
    "icp_profiles": DocTable(IcpProfile),
    "competitor_analyses": DocTable(CompetitorAnalysis),
    "competitors": DocTable(Competitor),
    "leads": DocTable(Lead),
    "lead_enrichments": DocTable(LeadEnrichment),
    "decision_makers": DocTable(DecisionMaker),
    "companies": DocTable(Company),
    "lead_lists": DocTable(LeadList),
    "serper_cache": DocTable(SerperCache),
}


from app.db import growth_models  # noqa: E402,F401  (registers the Phase 4 tables on Base/TABLES)
