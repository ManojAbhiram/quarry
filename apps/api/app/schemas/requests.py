from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class LeadRequestCreate(BaseModel):
    name: str
    description: Optional[str] = None
    primary_goal: Optional[str] = None
    target_team_size: Optional[str] = None
    request_type: Optional[str] = None  # "icp" (default) | "direct_companies"


class DraftUpdateRequest(BaseModel):
    """Payload for partially updating a draft request."""
    product_intake: Optional[dict] = None
    icp_dimensions: Optional[dict] = None
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None


class RequestListsUpdate(BaseModel):
    saved_companies: Optional[list[str]] = None
    excluded_companies: Optional[list[str]] = None
    manual_adds: Optional[list[dict]] = None


class LeadRequestOut(BaseModel):
    id: str
    title: str
    business_type: str
    location: str
    status: str
    date: str
    ideal_lead_profile: Optional[str] = None
    budget_target_size: Optional[str] = None
    description: Optional[str] = None
    primary_goal: Optional[str] = None
    target_team_size: Optional[str] = None
    template: Optional[str] = None
    goal: Optional[str] = None
    companies_count: int = 0
    contacts_count: int = 0
    icp_match_score: Optional[int] = None
    updated_at: Optional[str] = None
    request_type: Optional[str] = None
    product_intake: Optional[dict] = None
    icp_dimensions: Optional[dict] = None
    saved_companies: list[str] = []
    excluded_companies: list[str] = []
    manual_adds: list[dict] = []


class LeadRequestCreateResponse(BaseModel):
    id: str
    status: str


class StatsOut(BaseModel):
    total_leads: int
    pending: int
    completed: int
    failed: int
    active: int = 0
    draft: int = 0


def request_to_out(doc: dict, enrich_data: dict | None = None) -> LeadRequestOut:
    created_at: datetime = doc.get("created_at", datetime.utcnow())
    updated_at: datetime = doc.get("updated_at", created_at)
    date_str = created_at.strftime("%b %d, %Y") if hasattr(created_at, "strftime") else ""
    updated_str = updated_at.strftime("%b %d, %Y") if hasattr(updated_at, "strftime") else date_str

    raw_status = doc.get("status", "Pending")
    display_status = "Active" if raw_status == "Pending" else raw_status

    if enrich_data is None:
        enrich_data = {}

    leads_agg = enrich_data.get("leads_agg") or {}
    companies_list = leads_agg.get("companies") or []
    companies_count = leads_agg.get("count") or 0
    contacts_count = leads_agg.get("decision_makers_count") or 0
    avg_score = leads_agg.get("avg_score")
    icp_score = int(avg_score) if avg_score is not None else None

    product_intake = enrich_data.get("product_intake") or {}
    icp_dimensions = enrich_data.get("icp_dimensions") or {}

    template = product_intake.get("product_category") or doc.get("business_type", "")
    goal = product_intake.get("campaign_goal") or doc.get("primary_goal", "")

    return LeadRequestOut(
        id=str(doc["_id"]),
        title=doc.get("title", ""),
        business_type=doc.get("business_type", ""),
        location=doc.get("target_location", ""),
        status=display_status,
        date=date_str,
        ideal_lead_profile=doc.get("ideal_lead_profile"),
        budget_target_size=doc.get("budget_target_size"),
        description=doc.get("description"),
        primary_goal=doc.get("primary_goal") or goal,
        target_team_size=doc.get("target_team_size"),
        template=template,
        goal=goal,
        companies_count=companies_count,
        contacts_count=contacts_count,
        icp_match_score=icp_score,
        updated_at=updated_str,
        request_type=doc.get("request_type") or "icp",
        product_intake=product_intake or None,
        icp_dimensions=icp_dimensions or None,
        saved_companies=doc.get("saved_companies", []),
        excluded_companies=doc.get("excluded_companies", []),
        manual_adds=doc.get("manual_adds", []),
    )
