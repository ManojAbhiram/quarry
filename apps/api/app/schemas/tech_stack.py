from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TechStackDetectionRequest(BaseModel):
    url: str = Field(..., description="Website URL to analyze")
    timeout: int = Field(default=8, ge=1, le=60, description="Request timeout in seconds")


class TechStackDetectionResponse(BaseModel):
    status: str
    url: str
    technologies: List[str]
    infrastructure: Dict[str, Any]
    execution_time_ms: float
    error: Optional[str] = None
