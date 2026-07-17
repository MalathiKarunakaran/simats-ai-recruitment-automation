import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ApplicationStatusEnum


class ApplicationCreate(BaseModel):
    candidate_id: uuid.UUID
    job_posting_id: uuid.UUID


class ApplicationStatusTransitionRequest(BaseModel):
    status: ApplicationStatusEnum
    reason: str | None = None
    force: bool = False


class ApplicationPipelineDetailsUpdate(BaseModel):
    """Partial update for the flat, spreadsheet-shaped fields the real
    manual workflow tracks -- independent of the status transition itself."""

    panel_members: str | None = None
    panel_result: str | None = None
    panel_remarks: str | None = None
    salary_fixed: float | None = None
    called_date: date | None = None
    interview_scheduled_date: date | None = None
    offer_given_date: date | None = None
    expected_joining_date: date | None = None
    actual_joining_date: date | None = None


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    job_posting_id: uuid.UUID
    campus_id: uuid.UUID
    status: ApplicationStatusEnum
    applied_at: datetime
    recorded_by_id: uuid.UUID
    rejection_reason: str | None
    rejected_at: datetime | None
    withdrawn_reason: str | None
    withdrawn_at: datetime | None
    panel_members: str | None
    panel_result: str | None
    panel_remarks: str | None
    salary_fixed: float | None
    called_date: date | None
    interview_scheduled_date: date | None
    offer_given_date: date | None
    expected_joining_date: date | None
    actual_joining_date: date | None
    department_allotted_id: uuid.UUID | None
    room_allotted: str | None
    orientation_date: date | None
    hod_assigned: str | None
    created_at: datetime
    updated_at: datetime
