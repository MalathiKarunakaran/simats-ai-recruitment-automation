"""Schemas for Location bulk upload (Phase J, glowing-zooming-hamming.md).
Sibling to `app/schemas/sanctioned_strength_import.py` (own row-preview
shape, since Location rows carry different fields) -- see that module's own
docstring for why this isn't a shared generic union. The BulkUploadLog read
shape / undo response stay shared (`sanctioned_strength_import.py`), since
those back the 4 entity-agnostic endpoints.
"""

import uuid

from pydantic import BaseModel

from app.models.enums import StaffRoleCategoryEnum
from app.schemas.sanctioned_strength_import import BulkUploadRowStatus


class LocationBulkUploadRowPreview(BaseModel):
    row_number: int
    status: BulkUploadRowStatus
    error_reason: str | None = None
    campus_code: str | None = None
    location_name: str | None = None
    block_building: str | None = None
    floor_venue: str | None = None
    category: StaffRoleCategoryEnum | None = None


class LocationBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[LocationBulkUploadRowPreview]


class LocationBulkUploadCommitResponse(LocationBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
    # Non-null ONLY when the row commit itself succeeded but the original
    # workbook's archival copy failed after retries -- a non-blocking
    # warning, never a reason the whole commit failed. See
    # app/services/storage.py::try_upload_bulk_upload_file's own docstring.
    storage_warning: str | None = None
