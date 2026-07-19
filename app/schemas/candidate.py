import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

CandidateSource = Literal["Reference", "Job Portal", "FacultyPlus", "Walk-in"]


class CandidateCreate(BaseModel):
    full_name: str
    email: EmailStr
    phone_number: str | None = None
    source: CandidateSource | None = None
    reference_name: str | None = None

    @model_validator(mode="after")
    def _require_reference_name_for_reference_source(self) -> "CandidateCreate":
        if self.source == "Reference" and not self.reference_name:
            raise ValueError("reference_name is required when source is 'Reference'")
        return self


class CandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone_number: str | None
    resume_storage_key: str | None
    source: str | None
    reference_name: str | None
    is_withdrawn: bool
    withdrawn_at: datetime | None
    withdrawn_reason: str | None
    created_at: datetime
    updated_at: datetime


class CandidateWithdrawRequest(BaseModel):
    reason: str = Field(min_length=1)
