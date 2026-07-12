import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ApprovedVacancyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vacancy_request_id: uuid.UUID
    campus_id: uuid.UUID
    total_positions: int
    approved_by_id: uuid.UUID
    approved_at: datetime
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime
