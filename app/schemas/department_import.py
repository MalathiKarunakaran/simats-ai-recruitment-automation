"""Schemas for Department bulk upload (Department Master hardening epic,
2026-08-25). Sibling to `app/schemas/location_import.py` (own row-preview
shape, since Department rows carry different fields) -- see that module's
own docstring for why this isn't a shared generic union. The BulkUploadLog
read shape / undo response stay shared (`sanctioned_strength_import.py`),
since those back the 4 entity-agnostic endpoints.
"""

import uuid

from pydantic import BaseModel

from app.models.enums import StaffRoleCategoryEnum
from app.schemas.sanctioned_strength_import import BulkUploadRowStatus


class DepartmentBulkUploadRowPreview(BaseModel):
    row_number: int
    status: BulkUploadRowStatus
    error_reason: str | None = None
    campus_code: str | None = None
    department_code: str | None = None
    department_name: str | None = None
    category: StaffRoleCategoryEnum | None = None
    parent_group: str | None = None
    description: str | None = None
    is_active: bool | None = None


class DepartmentBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[DepartmentBulkUploadRowPreview]


class DepartmentBulkUploadCommitResponse(DepartmentBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
    # Non-null ONLY when the row commit itself succeeded but the original
    # workbook's archival copy failed after retries -- a non-blocking
    # warning, never a reason the whole commit failed. See
    # app/services/storage.py::try_upload_bulk_upload_file's own docstring.
    storage_warning: str | None = None
