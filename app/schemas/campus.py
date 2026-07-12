import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CampusBase(BaseModel):
    name: str
    is_active: bool = True


class CampusCreate(CampusBase):
    code: str


class CampusUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class CampusRead(CampusBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    created_at: datetime
    updated_at: datetime
