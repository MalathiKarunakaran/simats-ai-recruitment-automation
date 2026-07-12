import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import JoiningDocumentStatusEnum


class JoiningRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    joining_date: date
    actual_joining_date: date | None
    onboarding_completed_at: datetime | None
    onboarding_completed_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class JoiningDocumentUpdate(BaseModel):
    status: JoiningDocumentStatusEnum
    storage_key: str | None = None
    notes: str | None = None


class JoiningDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    document_type: str
    status: JoiningDocumentStatusEnum
    storage_key: str | None
    received_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
