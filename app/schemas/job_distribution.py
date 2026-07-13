import uuid
from typing import Any

from pydantic import BaseModel, Field

from app.services.job_distribution import SUPPORTED_PORTALS


class JobAdRead(BaseModel):
    job_posting_id: uuid.UUID
    position_title: str
    campus_code: str
    employment_type: str
    role_category: str
    qualification: str
    experience_required: str
    body: str
    apply_url: str
    public_apply_slug: str


class DistributeRequest(BaseModel):
    portals: list[str] = Field(default_factory=lambda: list(SUPPORTED_PORTALS))


class DistributeResponse(BaseModel):
    portals: list[str]
    n8n_response: dict[str, Any] | None
