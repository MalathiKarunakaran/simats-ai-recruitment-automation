import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StaffRoleCategoryEnum


class EligibilityRuleBase(BaseModel):
    staff_category: StaffRoleCategoryEnum
    position_title: str | None = None
    required_qualification_keyword: str
    # Category-specific optional fields -- only the ones relevant to a row's
    # own staff_category are typically populated; see
    # app/services/eligibility.py::check_qualification_mismatch.
    net_set_required: bool | None = None  # Teaching
    subject: str | None = None  # Teaching
    skills_keyword: str | None = None  # Non-Teaching
    id_proof_required: bool | None = None  # Housekeeping
    shift_preference: str | None = None  # Housekeeping
    is_active: bool = True
    notes: str | None = None


class EligibilityRuleCreate(EligibilityRuleBase):
    campus_id: uuid.UUID


class EligibilityRuleUpdate(BaseModel):
    campus_id: uuid.UUID | None = None
    staff_category: StaffRoleCategoryEnum | None = None
    position_title: str | None = None
    required_qualification_keyword: str | None = None
    net_set_required: bool | None = None
    subject: str | None = None
    skills_keyword: str | None = None
    id_proof_required: bool | None = None
    shift_preference: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class EligibilityRuleRead(EligibilityRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
