import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import HousekeepingShiftEnum


class HousekeepingStaffBase(BaseModel):
    bio_id: str
    name: str
    designation_id: uuid.UUID
    location_id: uuid.UUID
    block: str | None = None
    floor_venue: str | None = None
    shift: HousekeepingShiftEnum
    supervisor: str | None = None
    is_active: bool = True


class HousekeepingStaffCreate(HousekeepingStaffBase):
    campus_id: uuid.UUID


class HousekeepingStaffUpdate(BaseModel):
    bio_id: str | None = None
    name: str | None = None
    designation_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    block: str | None = None
    floor_venue: str | None = None
    shift: HousekeepingShiftEnum | None = None
    supervisor: str | None = None
    is_active: bool | None = None


class HousekeepingStaffRead(HousekeepingStaffBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_by_id: uuid.UUID
    updated_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
