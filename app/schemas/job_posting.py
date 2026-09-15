import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.enums import EmploymentTypeEnum, JobPostingStatusEnum, StaffRoleCategoryEnum, VacancyPriorityEnum

MAX_SKILLS = 50


class JobPostingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approved_vacancy_id: uuid.UUID
    campus_id: uuid.UUID
    role_category: StaffRoleCategoryEnum
    public_apply_slug: str
    # NULL until the posting first goes live (2026-09-15).
    published_at: datetime | None
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
    # The counts the posting screens show (2026-09-15): requested = approved
    # total, filled = joined, remaining = requested - filled. Derived only.
    positions_requested: int
    positions_filled: int
    positions_remaining: int
    # Content and lifecycle (2026-09-06).
    posting_number: str | None
    status: JobPostingStatusEnum
    ad_title: str | None
    ad_body: str | None
    apply_deadline: date | None
    contact_email: str | None
    last_edited_by_id: uuid.UUID | None
    last_edited_by_name: str | None
    last_edited_at: datetime | None
    is_accepting_applications: bool
    vacancy_request_id: uuid.UUID
    vacancy_request_ref: str | None
    requisition_number: str | None
    # Detail view (2026-09-15), read through the vacancy request's master data.
    campus_code: str
    campus_name: str
    department_name: str
    designation_id: uuid.UUID | None
    designation_name: str | None
    priority: VacancyPriorityEnum
    required_by: date | None
    # Structured job content (2026-09-15).
    summary: str | None
    responsibilities: str | None
    required_qualification: str | None
    required_experience: str | None
    required_skills: list[str] | None
    preferred_skills: list[str] | None
    employment_type: EmploymentTypeEnum | None
    location_id: uuid.UUID | None
    location_label: str | None
    salary_min: float | None
    salary_max: float | None
    ai_generated_at: datetime | None
    # Review trail (2026-09-15).
    created_by_id: uuid.UUID | None
    created_by_name: str | None
    submitted_for_review_by_id: uuid.UUID | None
    submitted_for_review_by_name: str | None
    submitted_for_review_at: datetime | None
    approved_by_id: uuid.UUID | None
    approved_by_name: str | None
    approved_at: datetime | None
    published_by_id: uuid.UUID | None
    published_by_name: str | None


def _clean_skills(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    cleaned = [item.strip() for item in value if item and item.strip()]
    if len(cleaned) > MAX_SKILLS:
        raise ValueError(f"At most {MAX_SKILLS} skills")
    if any(len(item) > 100 for item in cleaned):
        raise ValueError("A skill is at most 100 characters")
    return cleaned or None


class JobPostingUpdate(BaseModel):
    """Editable job content. Positions, status and the review trail are
    never written here: counts are derived and status moves only through the
    lifecycle endpoints."""

    ad_title: str | None = Field(default=None, min_length=1, max_length=200)
    ad_body: str | None = Field(default=None, min_length=1, max_length=20_000)
    apply_deadline: date | None = None
    contact_email: EmailStr | None = None
    summary: str | None = Field(default=None, max_length=2_000)
    responsibilities: str | None = Field(default=None, max_length=10_000)
    required_qualification: str | None = Field(default=None, max_length=2_000)
    required_experience: str | None = Field(default=None, max_length=100)
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    employment_type: EmploymentTypeEnum | None = None
    location_id: uuid.UUID | None = None
    salary_min: float | None = Field(default=None, ge=0)
    salary_max: float | None = Field(default=None, ge=0)

    _skills = field_validator("required_skills", "preferred_skills")(_clean_skills)

    @model_validator(mode="after")
    def _salary_range(self):
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("salary_min is greater than salary_max")
        return self


class JobPostingReturnToDraftRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1_000)


class JobPostingGenerateContentRequest(BaseModel):
    additional_instructions: str | None = Field(default=None, max_length=2_000)


class JdAiStatusRead(BaseModel):
    configured: bool
    provider: str
    model: str | None
    message: str | None
