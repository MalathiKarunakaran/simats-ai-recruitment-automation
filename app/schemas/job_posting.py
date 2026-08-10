import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum


class JobPostingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approved_vacancy_id: uuid.UUID
    campus_id: uuid.UUID
    role_category: StaffRoleCategoryEnum
    public_apply_slug: str
    published_at: datetime
    closed_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Position-tracking fields (JobPosting model @properties). requested_count
    # is still-needed (OPEN + RESERVED hiring slots); available_count is
    # already-filled/staffed (FILLED hiring slots) -- the two always sum to
    # the vacancy's originally approved total_positions.
    position_title: str
    department_id: uuid.UUID
    requested_count: int
    available_count: int
