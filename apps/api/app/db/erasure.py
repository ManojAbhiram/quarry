"""Cascading deletion: removing a request or an account also removes the leads and the third-party people in them.

Leads, decision makers (names, emails, LinkedIn URLs) and enrichments are personal data about people who never
signed up for Quarry, so they must not outlive the request or account that collected them. The shared `companies`
table holds company facts, not people, and is intentionally kept.
"""
from sqlalchemy import delete, select

from app.db import engine as _engine
from app.db.models import (
    Competitor,
    CompetitorAnalysis,
    DecisionMaker,
    IcpProfile,
    Lead,
    LeadEnrichment,
    LeadList,
    LeadListItem,
    Organization,
    ProductIntake,
    Request,
    User,
    UserSession,
)


async def _delete_leads(s, lead_ids: list[str]) -> None:
    if not lead_ids:
        return
    await s.execute(delete(DecisionMaker).where(DecisionMaker.lead_id.in_(lead_ids)))
    await s.execute(delete(LeadEnrichment).where(LeadEnrichment.lead_id.in_(lead_ids)))
    await s.execute(delete(LeadListItem).where(LeadListItem.lead_id.in_(lead_ids)))
    await s.execute(delete(Lead).where(Lead.id.in_(lead_ids)))


async def _delete_analyses(s, analysis_ids: list[str]) -> None:
    if not analysis_ids:
        return
    await s.execute(delete(Competitor).where(Competitor.analysis_id.in_(analysis_ids)))
    await s.execute(delete(CompetitorAnalysis).where(CompetitorAnalysis.id.in_(analysis_ids)))


async def erase_request(request_id: str) -> bool:
    """Delete a request and everything collected for it. Returns False if it did not exist."""
    request_id = str(request_id)
    async with _engine.session() as s, s.begin():
        lead_ids = list((await s.execute(select(Lead.id).where(Lead.request_id == request_id))).scalars())
        await _delete_leads(s, lead_ids)
        await s.execute(delete(ProductIntake).where(ProductIntake.request_id == request_id))
        await s.execute(delete(IcpProfile).where(IcpProfile.request_id == request_id))
        analysis_ids = list(
            (await s.execute(select(CompetitorAnalysis.id).where(CompetitorAnalysis.request_id == request_id))).scalars()
        )
        await _delete_analyses(s, analysis_ids)
        result = await s.execute(delete(Request).where(Request.id == request_id))
        return result.rowcount > 0


async def erase_user_data(user_id: str) -> None:
    """Delete an account and everything it owns: requests (with their leads), lists, sessions and the user."""
    uid = str(user_id)
    async with _engine.read_session() as s, s.begin():
        request_ids = list((await s.execute(select(Request.id).where(Request.user_id == uid))).scalars())
        org_id = (await s.execute(select(User.org_id).where(User.id == uid))).scalar_one_or_none()
    for rid in request_ids:
        await erase_request(rid)

    async with _engine.session() as s, s.begin():
        # leads that no longer belong to any request but still carry this user's id
        await _delete_leads(s, list((await s.execute(select(Lead.id).where(Lead.user_id == uid))).scalars()))
        await s.execute(delete(LeadList).where(LeadList.user_id == uid))  # memberships go with it (cascade)
        await _delete_analyses(
            s, list((await s.execute(select(CompetitorAnalysis.id).where(CompetitorAnalysis.user_id == uid))).scalars())
        )
        # legacy "request" documents stored in the competitors table keep the owner in their JSON data
        orphans = (await s.execute(select(Competitor).where(Competitor.analysis_id.is_(None)))).scalars().all()
        for row in orphans:
            if (row.data or {}).get("user_id") == uid:
                await s.delete(row)
        await s.execute(delete(UserSession).where(UserSession.user_id == uid))
        await s.execute(delete(User).where(User.id == uid))
        if org_id:
            remaining = (await s.execute(select(User.id).where(User.org_id == org_id).limit(1))).first()
            if remaining is None:
                await s.execute(delete(Organization).where(Organization.id == org_id))
