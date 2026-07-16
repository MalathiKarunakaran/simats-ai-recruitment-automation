import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ApplicationStatusEnum


class ApplicationCreate(BaseModel):
    candidate_id: uuid.UUID
    job_posting_id: uuid.UUID


class ApplicationStatusTransitionRequest(BaseModel):
    status: ApplicationStatusEnum
    reason: str | None = None
    force: bool = False


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
    created_at: datetime
    updated_at: datetime
