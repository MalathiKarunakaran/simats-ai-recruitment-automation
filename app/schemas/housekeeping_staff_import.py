"""Schemas for HousekeepingStaff bulk upload (Phase J,
glowing-zooming-hamming.md). Sibling to
`app/schemas/sanctioned_strength_import.py`/`app/schemas/location_import.py`
-- see the former's docstring for why this isn't a shared generic union.
"""

import uuid

from pydantic import BaseModel

from app.models.enums import HousekeepingShiftEnum
from app.schemas.sanctioned_strength_import import BulkUploadRowStatus


class HousekeepingStaffBulkUploadRowPreview(BaseModel):
    row_number: int
    status: BulkUploadRowStatus
    error_reason: str | None = None
    campus_code: str | None = None
    bio_id: str | None = None
    name: str | None = None
    designation_name: str | None = None
    location_name: str | None = None
    block: str | None = None
    floor_venue: str | None = None
    shift: HousekeepingShiftEnum | None = None
    supervisor: str | None = None


class HousekeepingStaffBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[HousekeepingStaffBulkUploadRowPreview]


class HousekeepingStaffBulkUploadCommitResponse(HousekeepingStaffBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
