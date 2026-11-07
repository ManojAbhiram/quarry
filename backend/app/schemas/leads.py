from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class LeadRequest(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str


class DecisionMaker(BaseModel):
    name: str
    title: str
    linkedin_url: str
    email: Optional[str] = None
    snippet: Optional[str] = None
    recent_activity_summary: Optional[str] = None
    recent_posts: List[str] = []


class Competitor(BaseModel):
    name: str
    website: str
    tier: str  # Direct / Adjacent / DIY
    headquarters: str
    employee_count: str
    funding_stage: str
    pricing_model: str
    deployment_model: str
    description: str
    overlap_score: int
    g2_rating: float
    capterra_rating: float
    pros: List[str] = []
    cons: List[str] = []
    signals: List[str] = []
    customers: List[str] = []
    deal_size: str
    total_customers: str


class Lead(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str
    title: str
    url: str
    email: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None
    match_score: Optional[str] = "0"
    snippet: Optional[str] = None
    type: str = "enriched"
    
    # Richer v2 fields
    company_name: Optional[str] = None
    industry: Optional[str] = None
    location: Optional[str] = None
    contact_name: Optional[str] = None
    contact_title: Optional[str] = None
    employee_size_estimate: Optional[str] = None
    funding_stage: Optional[str] = None
    founded_year: Optional[str] = None
    
    # Social URLs
    linkedin_url: Optional[str] = None
    x_url: Optional[str] = None
    facebook_url: Optional[str] = None
    crunchbase_url: Optional[str] = None
    
    # Semantic signals
    buying_signals: Optional[str] = None
    match_explanation: Optional[str] = None
    decision_makers: List[DecisionMaker] = []
    
    # Custom high-fidelity design fields
    growth: Optional[str] = None
    signals: List[str] = []
    tech_stack: List[str] = []
    infrastructure: dict[str, List[str]] = {}


class SearchQueryList(BaseModel):
    queries: List[str] = Field(
        min_length=2,
        max_length=20,
        description="A list of Google search queries to find target companies/leads",
    )


class SiteClassification(BaseModel):
    url: str
    site_type: Literal["standalone", "directory"]
    reasoning: str = Field(
        description="Brief reason (e.g., 'Wikipedia list' or 'Specific hospital site')"
    )


class BatchClassificationResponse(BaseModel):
    results: List[SiteClassification]


class LeadStatusResponse(BaseModel):
    request_id: str
    status: str
    leads_count: int
    queries_count: int


class LeadsListResponse(BaseModel):
    request_id: str
    status: str
    queries: List[str]
    leads: List[dict]
    competitors: List[dict] = []
    total_found: int
