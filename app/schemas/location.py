import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum


class LocationBase(BaseModel):
    name: str
    block_building: str | None = None
    floor_venue: str | None = None
    category: StaffRoleCategoryEnum | None = None
    is_active: bool = True


class LocationCreate(LocationBase):
    campus_id: uuid.UUID


class LocationUpdate(BaseModel):
    name: str | None = None
    block_building: str | None = None
    floor_venue: str | None = None
    category: StaffRoleCategoryEnum | None = None
    is_active: bool | None = None


class LocationRead(LocationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
