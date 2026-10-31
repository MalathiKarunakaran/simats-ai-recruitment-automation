import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

MAX_BATCH_MEMBERS = 500


def _clean(value: str | None) -> str | None:
    value = " ".join((value or "").split())
    return value or None


class SelectionBatchMemberIn(BaseModel):
    talent_pool_entry_id: uuid.UUID
    # Typed per person in the dialog; both optional.
    designation: str | None = Field(None, max_length=255)
    proposed_salary: str | None = Field(None, max_length=100)

    _tidy = field_validator("designation", "proposed_salary")(_clean)


class SelectionBatchCreate(BaseModel):
    members: list[SelectionBatchMemberIn] = Field(min_length=1, max_length=MAX_BATCH_MEMBERS)
    campus_id: uuid.UUID | None = None
    note: str | None = Field(None, max_length=2000)
    sent_on: date | None = None  # defaults to today

    _tidy = field_validator("note")(_clean)


class UniversityApproval(BaseModel):
    university_ref_no: str = Field(min_length=1, max_length=100)
    university_approved_on: date

    @field_validator("university_ref_no")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("University reference number is required")
        return value


class SelectionBatchWithdraw(BaseModel):
    reason: str | None = Field(None, max_length=500)


class SelectionBatchMemberOut(BaseModel):
    id: uuid.UUID
    talent_pool_entry_id: uuid.UUID
    full_name: str
    designation: str | None
    department: str | None
    category: str | None
    qualification: str | None
    experience: str | None
    panel_remarks: str | None
    proposed_salary: str | None

    model_config = {"from_attributes": True}


class SelectionBatchOut(BaseModel):
    id: uuid.UUID
    batch_no: str
    status: str
    campus_id: uuid.UUID | None
    campus_code: str | None
    note: str | None
    sent_on: date
    university_ref_no: str | None
    university_approved_on: date | None
    created_by_id: uuid.UUID
    approval_recorded_by_id: uuid.UUID | None
    member_count: int
    created_at: datetime


class SelectionBatchDetail(SelectionBatchOut):
    members: list[SelectionBatchMemberOut]
