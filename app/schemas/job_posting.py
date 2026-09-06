import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import JobPostingStatusEnum, StaffRoleCategoryEnum


class JobPostingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approved_vacancy_id: uuid.UUID
    campus_id: uuid.UUID
    role_category: StaffRoleCategoryEnum
    public_apply_slug: str
    published_at: datetime
    closed_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Position-tracking fields (JobPosting model @properties). requested_count
    # is still-needed (OPEN + RESERVED hiring slots); available_count is
    # already-filled/staffed (FILLED hiring slots) -- the two always sum to
    # the vacancy's originally approved total_positions.
    position_title: str
    department_id: uuid.UUID
    requested_count: int
    available_count: int
    # Content and lifecycle (2026-09-06).
    posting_number: str | None
    status: JobPostingStatusEnum
    ad_title: str | None
    ad_body: str | None
    apply_deadline: date | None
    contact_email: str | None
    last_edited_by_id: uuid.UUID | None
    last_edited_at: datetime | None
    is_accepting_applications: bool
    vacancy_request_id: uuid.UUID
    requisition_number: str | None


class JobPostingUpdate(BaseModel):
    """Editable ad content. Everything else about a posting is derived
    from the request or moved by a lifecycle action."""

    ad_title: str | None = Field(default=None, min_length=1, max_length=200)
    ad_body: str | None = Field(default=None, min_length=1, max_length=20_000)
    apply_deadline: date | None = None
    contact_email: EmailStr | None = None
