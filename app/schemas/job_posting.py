import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobPostingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approved_vacancy_id: uuid.UUID
    campus_id: uuid.UUID
    public_apply_slug: str
    published_at: datetime
    closed_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
