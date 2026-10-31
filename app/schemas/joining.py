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
    # Super Admin only, and only needed when the department has no vacancy.
    override_reason: str | None = Field(default=None, max_length=1000)


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


# --- Provisional order + department allotment (2026-10-31) -------------------


class ProvisionalOrderCreate(BaseModel):
    # Defaults to today; settable for an order dated before it was keyed in.
    order_date: date | None = None
    # Printed under the name. The form prefills it from the candidate; saved
    # to the candidate as well when the candidate has none.
    address: str | None = Field(default=None, max_length=1000)


class AppointmentOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    order_number: str
    sequence: int
    order_date: date
    status: str
    issued_by_id: uuid.UUID
    issued_at: datetime
    candidate_name: str
    address: str | None
    designation: str
    category: str
    campus_code: str
    college_name: str
    principal_name: str
    department_name: str
    joining_date: date | None
    probation_end_date: date
    signed_copy_content_type: str | None
    signed_copy_size: int | None
    signed_copy_uploaded_at: datetime | None


class DepartmentOption(BaseModel):
    department_id: uuid.UUID
    department_name: str
    sanctioned: int
    working: int
    reserved: int
    vacancy: int
    suggested: bool


class DepartmentOptionsResponse(BaseModel):
    designation_id: uuid.UUID | None
    # RESUME_QUALIFICATION or VACANCY -- what the suggestion was matched on.
    suggestion_basis: str
    suggestion_text: str
    options: list[DepartmentOption]
