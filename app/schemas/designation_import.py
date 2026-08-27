"""Schemas for Designation bulk upload (Designation Master bulk-upload epic,
backend Phase 1). Sibling to `app/schemas/department_import.py` (own
row-preview shape, since Designation rows carry different fields -- notably
`department_codes` as a display list rather than a single `department_id`,
since a Designation can map to multiple departments simultaneously). The
BulkUploadLog read shape / undo response stay shared
(`sanctioned_strength_import.py`), since those back the 4 entity-agnostic
endpoints.
"""

import uuid
from typing import Literal

from pydantic import BaseModel

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum

# Designation's own status literal rather than the shared
# `sanctioned_strength_import.BulkUploadRowStatus`: only Designation can
# produce "merged" (several rows describing one designation, their department
# codes unioned -- see app/services/designation_import.py's docstring).
# Deliberately NOT added to the shared literal, which would widen every other
# entity's response contract to advertise a status they can never return.
DesignationBulkUploadRowStatus = Literal["created", "updated", "unchanged", "merged", "rejected"]


class DesignationBulkUploadRowPreview(BaseModel):
    row_number: int
    status: DesignationBulkUploadRowStatus
    error_reason: str | None = None
    # Set only when status == "merged": the earlier row this row's department
    # codes were folded into, which carries the group's real status.
    merged_into_row: int | None = None
    name: str | None = None
    category: StaffRoleCategoryEnum | None = None
    department_codes: list[str] = []
    qualification: str | None = None
    min_experience: str | None = None
    employment_type: EmploymentTypeEnum | None = None
    required_skills: str | None = None
    is_active: bool | None = None


class DesignationBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    merged_count: int = 0
    rows: list[DesignationBulkUploadRowPreview]


class DesignationBulkUploadCommitResponse(DesignationBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
    # Non-null ONLY when the row commit itself succeeded but the original
    # workbook's archival copy failed after retries -- a non-blocking
    # warning, never a reason the whole commit failed. See
    # app/services/storage.py::try_upload_bulk_upload_file's own docstring.
    storage_warning: str | None = None
