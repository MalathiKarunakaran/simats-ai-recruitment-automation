import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ResumeScoreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    eligibility_score: float | None
    skill_match_pct: float | None
    qualification_match_pct: float | None
    experience_match_pct: float | None
    publication_count: int | None
    overall_recruitment_score: float | None
    semantic_similarity_score: float | None
    rationale: str | None
    extracted_skills: list[str] | None
    extracted_qualification: str | None
    extracted_experience_years: float | None
    is_duplicate: bool
    duplicate_of_candidate_id: uuid.UUID | None
    is_incomplete_profile: bool
    incomplete_reasons: list[str] | None
    screened_at: datetime | None
    screened_by_id: uuid.UUID | None
    model_version: str | None
    created_at: datetime
    updated_at: datetime


class RankedApplicationRead(BaseModel):
    """Application + its ResumeScore, for the candidate-ranking endpoint."""

    model_config = ConfigDict(from_attributes=True)

    application_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_full_name: str
    candidate_email: str
    application_status: str
    overall_recruitment_score: float | None
    eligibility_score: float | None
    is_duplicate: bool
    is_incomplete_profile: bool
