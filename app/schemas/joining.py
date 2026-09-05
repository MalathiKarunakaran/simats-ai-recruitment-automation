import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import HousekeepingShiftEnum, JoiningDocumentStatusEnum


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


class DepartmentRoomAllotmentRequest(BaseModel):
    department_id: uuid.UUID
    room_allotted: str | None = None


class OrientationCompleteRequest(BaseModel):
    orientation_date: date | None = None


class HandoverToHodRequest(BaseModel):
    hod_assigned: str
    designation: str | None = None
    # Housekeeping only (app/services/joining.py::create_employee): the
    # roster row that makes the hire count as "working" needs the
    # biometric attendance ID and the shift, which nothing earlier in the
    # pipeline collects. location_id defaults to the vacancy request's own
    # location. All ignored for Teaching / Non-Teaching.
    bio_id: str | None = Field(default=None, max_length=50)
    shift: HousekeepingShiftEnum | None = None
    location_id: uuid.UUID | None = None
    supervisor: str | None = Field(default=None, max_length=150)
