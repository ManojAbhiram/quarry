# Re-export all public schema symbols from domain-specific modules.
# Import from the specific module for new code; these re-exports keep
# existing imports in api/services working without changes.

from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    RefreshRequest,
    RefreshResponse,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    GoogleCallbackRequest,
)
from app.schemas.users import (
    UserOut,
    AuthResponse,
    ProfileUpdate,
    SerperKeyUpdate,
    SerperKeyStatus,
    user_to_out,
)
from app.schemas.organizations import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationOut,
    org_to_out,
)
from app.schemas.requests import (
    LeadRequestCreate,
    LeadRequestCreateResponse,
    DraftUpdateRequest,
    LeadRequestOut,
    StatsOut,
    request_to_out,
)
from app.schemas.request_intake import (
    ProductIntakeForm,
    ICPDimension,
    StructuredICP,
    SuggestChipRequest,
    SuggestChipResponse,
    FindCompetitorsRequest,
    ConsistencyCheckResponse,
    RequestIntakeCreate,
    RequestIntakeResponse,
    CompetitorResult,
    CompetitorListResponse,
    ProductSimilarityResearchRequest,
    ProductSimilarityResearchResponse,
)
from app.schemas.leads import (
    Lead,
    DecisionMaker,
    Competitor,
    LeadStatusResponse,
    LeadsListResponse,
    SearchQueryList,
    SiteClassification,
    BatchClassificationResponse,
)

__all__ = [
    # auth
    "RegisterRequest", "LoginRequest", "RefreshRequest", "RefreshResponse",
    "ForgotPasswordRequest", "ResetPasswordRequest", "GoogleCallbackRequest",
    # users
    "UserOut", "AuthResponse", "ProfileUpdate", "user_to_out",
    "SerperKeyUpdate", "SerperKeyStatus",
    # organizations
    "OrganizationCreate", "OrganizationUpdate", "OrganizationOut", "org_to_out",
    # requests
    "LeadRequestCreate", "LeadRequestCreateResponse", "DraftUpdateRequest",
    "LeadRequestOut", "StatsOut", "request_to_out",
    # campaigns
    "ProductIntakeForm", "ICPDimension", "StructuredICP",
    "SuggestChipRequest", "SuggestChipResponse",
    "FindCompetitorsRequest", "ConsistencyCheckResponse",
    "RequestIntakeCreate", "RequestIntakeResponse",
    "CompetitorResult", "CompetitorListResponse",
    "ProductSimilarityResearchRequest", "ProductSimilarityResearchResponse",
    # leads
    "Lead", "DecisionMaker", "Competitor",
    "LeadStatusResponse", "LeadsListResponse",
    "SearchQueryList", "SiteClassification", "BatchClassificationResponse",
]
