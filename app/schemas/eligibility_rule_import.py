"""Schemas for EligibilityRule bulk upload (starter regulatory-eligibility-
rules feature, backend Phase 1). Sibling to `app/schemas/department_import.py`
(own row-preview shape, since EligibilityRule rows carry many more fields) --
see that module's own docstring for why this isn't a shared generic union.
The BulkUploadLog read shape / undo response stay shared
(`sanctioned_strength_import.py`), since those back the 4 entity-agnostic
endpoints.
"""

import uuid
from datetime import date

from pydantic import BaseModel

from app.models.enums import EligibilityRuleStatusEnum, RegulatoryAuthorityEnum, StaffRoleCategoryEnum
from app.schemas.sanctioned_strength_import import BulkUploadRowStatus


class EligibilityRuleBulkUploadRowPreview(BaseModel):
    row_number: int
    status: BulkUploadRowStatus
    error_reason: str | None = None
    campus_code: str | None = None
    department_code: str | None = None
    staff_category: StaffRoleCategoryEnum | None = None
    position_title: str | None = None
    required_qualification_keyword: str | None = None
    net_set_required: bool | None = None
    subject: str | None = None
    skills_keyword: str | None = None
    id_proof_required: bool | None = None
    shift_preference: str | None = None
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
    rule_status: EligibilityRuleStatusEnum | None = None
    verification_required: bool | None = None
    is_active: bool | None = None
    notes: str | None = None


class EligibilityRuleBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[EligibilityRuleBulkUploadRowPreview]


class EligibilityRuleBulkUploadCommitResponse(EligibilityRuleBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
    # Non-null ONLY when the row commit itself succeeded but the original
    # workbook's archival copy failed after retries -- a non-blocking
    # warning, never a reason the whole commit failed. See
    # app/services/storage.py::try_upload_bulk_upload_file's own docstring.
    storage_warning: str | None = None
