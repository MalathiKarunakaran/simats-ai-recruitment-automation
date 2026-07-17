import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


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
    date_of_joining: date
    user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
