import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import HiringSlotStatusEnum


class HiringSlotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    approved_vacancy_id: uuid.UUID
    slot_number: int
    status: HiringSlotStatusEnum
    reserved_application_id: uuid.UUID | None
    reserved_at: datetime | None
    filled_at: datetime | None
    released_at: datetime | None
    created_at: datetime
    updated_at: datetime
