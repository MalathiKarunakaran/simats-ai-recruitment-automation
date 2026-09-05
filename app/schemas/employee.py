import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EmploymentStatusEnum


class EmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    employee_code: str
    campus_id: uuid.UUID
    department_id: uuid.UUID | None
    full_name: str
    email: str
    phone_number: str | None
    designation: str
    designation_id: uuid.UUID | None = None
    date_of_joining: date
    user_id: uuid.UUID | None
    employment_status: EmploymentStatusEnum
    separation_date: date | None
    separation_reason: str | None
    separated_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class EmployeeOffboardRequest(BaseModel):
    separation_type: EmploymentStatusEnum
    separation_date: date
    reason: str = Field(min_length=1)
