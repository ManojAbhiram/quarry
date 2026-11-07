from typing import List, Optional, Union
from pydantic import BaseModel, Field


# ── Intake form ───────────────────────────────────────────────────────────────

class ProductIntakeForm(BaseModel):
    product_name: str = Field(..., description="Name of the product/service")
    product_category: str = Field(..., description="Category or taxonomy of the product")
    one_liner: str = Field(..., description="One sentence description of what the product does")
    deployment_model: str = Field(..., description="SaaS / Self-hosted / Hybrid")
    primary_value_prop: str = Field(..., description="Core problem solved by the product")
    pricing_model: str = Field(..., description="Seat / Usage / Flat / Open-Core")
    existing_competitors: str = Field(..., description="Free-text list of known alternative competitors")
    deal_size_acv: str = Field(..., description="Average Contract Value range, e.g. $20K-$200K ARR")
    target_geographies: str = Field(..., description="Target regions or countries")
    product_description: str = Field(..., description="Detailed description of the product, features, and use cases")
    current_customers: Optional[str] = None
    integration_ecosystem: Optional[str] = None
    compliance_certs: Optional[str] = None
    min_headcount: Optional[str] = None
    exclude_list: Optional[str] = None
    request_goal: Optional[str] = None
    num_leads: Optional[int] = Field(None, description="Target number of leads to generate")


# ── ICP ───────────────────────────────────────────────────────────────────────

class ICPDimension(BaseModel):
    value: str = Field(..., description="Bullet-pointed list content of this dimension")
    confidence: str = Field("High Confidence", description="High Confidence | Medium Confidence | Low Confidence")
    warning: Optional[str] = Field(None, description="Alert text when confidence is Low or Medium")


class StructuredICP(BaseModel):
    firmographic: Union[ICPDimension, str] = Field(..., description="industry, company size, revenue, geo, growth stage")
    technographic: Union[ICPDimension, str] = Field(..., description="data stack, cloud provider, analytics tools")
    team_structure: Union[ICPDimension, str] = Field(..., description="data team size, analytics maturity")
    buying_signals: Union[ICPDimension, str] = Field(..., description="hiring signals, funding events, tool evaluations")
    compliance: Union[ICPDimension, str] = Field(..., description="HIPAA, GDPR, FedRAMP sensitivity")
    deployment_pref: Union[ICPDimension, str] = Field(..., description="cloud infra, on-prem maturity")


# ── Requests ──────────────────────────────────────────────────────────────────

class SuggestChipRequest(BaseModel):
    chip_type: str
    product_name: Optional[str] = None
    product_category: Optional[str] = None
    current_description: Optional[str] = None


class FindCompetitorsRequest(BaseModel):
    product_description: str
    request_id: str


class RequestIntakeCreate(BaseModel):
    product_intake: ProductIntakeForm
    icp_dimensions: StructuredICP
    num_leads: Optional[int] = Field(10, description="Target number of leads to generate")


class DirectCompaniesCreate(BaseModel):
    """Payload for the 'direct companies → decision makers' flow.

    The user supplies a list of company names/domains plus the decision-maker
    titles/roles they want to target. No ICP / product intake is required.
    """
    title: Optional[str] = Field(None, description="Optional name for this lead request")
    companies: List[str] = Field(..., min_length=1, description="Company names or domains to find decision makers for")
    target_roles: List[str] = Field(
        default_factory=list,
        description="Decision-maker titles/roles to target, e.g. ['CEO', 'VP Sales']",
    )


# ── Responses ─────────────────────────────────────────────────────────────────

class SuggestChipResponse(BaseModel):
    suggestion: str


class ConsistencyCheckResponse(BaseModel):
    consistent: bool
    warnings: List[str] = []


class CompetitorResult(BaseModel):
    request_id: str
    total: int
    results: List[dict] = []


class CompetitorListResponse(BaseModel):
    request_id: str
    status: Optional[str] = None
    total: int
    results: List[dict] = []


class RequestIntakeResponse(BaseModel):
    message: str
    request_id: str
    status: str


class ProductSimilarityResearchRequest(BaseModel):
    product_description: str = Field(
        ..., description="Detailed product description used to generate search queries and find similar market products"
    )


class ProductSimilarityResearchResponse(BaseModel):
    message: str
    request_id: str
    status: str


# ── Internal ──────────────────────────────────────────────────────────────────

class ProductSimilarityMatch(BaseModel):
    company_name: str = Field(..., description="Matched company name")
    website: str = Field(..., description="Matched website URL")
    source_url: str = Field(..., description="Source search result URL")
    reason: Optional[str] = Field(None, description="Brief validation reason")
