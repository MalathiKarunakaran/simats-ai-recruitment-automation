import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import EligibilityRuleStatusEnum, RegulatoryAuthorityEnum, StaffRoleCategoryEnum


class EligibilityRuleBase(BaseModel):
    staff_category: StaffRoleCategoryEnum
    position_title: str | None = None
    required_qualification_keyword: str
    # Category-specific optional fields -- only the ones relevant to a row's
    # own staff_category are typically populated; see
    # app/services/eligibility.py::check_qualification_mismatch.
    net_set_required: bool | None = None  # Teaching (also covers SLET)
    subject: str | None = None  # Teaching
    skills_keyword: str | None = None  # Non-Teaching
    id_proof_required: bool | None = None  # Housekeeping
    shift_preference: str | None = None  # Housekeeping
    is_active: bool = True
    notes: str | None = None

    # --- Starter regulatory-eligibility-rules fields (all descriptive/
    # display only unless documented otherwise on the model -- see
    # app/models/eligibility_rule.py's own docstring) -------------------
    department_id: uuid.UUID | None = None
    regulatory_authority: RegulatoryAuthorityEnum | None = None
    school_or_college: str | None = None
    programme_discipline: str | None = None
    minimum_qualification: str | None = None
    minimum_percentage: str | None = None
    required_experience: str | None = None
    required_credential: str | None = None
    # Informational only -- never consulted by check_qualification_mismatch.
    required_keywords: str | None = None
    preferred_keywords: str | None = None
    phd_required: bool | None = None
    professional_registration: str | None = None
    industry_experience: str | None = None
    priority: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    source_regulation: str | None = None
    # Independent of is_active -- see the model's own docstring.
    status: EligibilityRuleStatusEnum = EligibilityRuleStatusEnum.DRAFT
    verification_required: bool = True


class EligibilityRuleCreate(EligibilityRuleBase):
    campus_id: uuid.UUID
    department_id: uuid.UUID | None = None


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

    department_id: uuid.UUID | None = None
    regulatory_authority: RegulatoryAuthorityEnum | None = None
    school_or_college: str | None = None
    programme_discipline: str | None = None
    minimum_qualification: str | None = None
    minimum_percentage: str | None = None
    required_experience: str | None = None
    required_credential: str | None = None
    required_keywords: str | None = None
    preferred_keywords: str | None = None
    phd_required: bool | None = None
    professional_registration: str | None = None
    industry_experience: str | None = None
    priority: str | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    source_regulation: str | None = None
    status: EligibilityRuleStatusEnum | None = None
    verification_required: bool | None = None


class EligibilityRuleRead(EligibilityRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
