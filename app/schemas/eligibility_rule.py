import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum


class EligibilityRuleBase(BaseModel):
    staff_category: StaffRoleCategoryEnum
    position_title: str | None = None
    required_qualification_keyword: str
    is_active: bool = True
    notes: str | None = None


class EligibilityRuleCreate(EligibilityRuleBase):
    campus_id: uuid.UUID


class EligibilityRuleUpdate(BaseModel):
    campus_id: uuid.UUID | None = None
    staff_category: StaffRoleCategoryEnum | None = None
    position_title: str | None = None
    required_qualification_keyword: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class EligibilityRuleRead(EligibilityRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
