"""Schemas for Sanctioned Strength bulk upload (zany-snuggling-pie.md Phase
F): validate/commit preview rows + summary, the BulkUploadLog read shape for
the "Upload history" tab, and the undo response.

See app/services/sanctioned_strength_import.py for the row-status model
(created/updated/unchanged/rejected) and why this codebase's real schema
(no `designation.code` column, optional/non-unique `department.code`) means
rows are keyed on (Campus Code, Department Name, Designation Name) rather
than the "codes" wording used in the plan doc.

Phase J (glowing-zooming-hamming.md) extends this bulk-upload machinery to
Location and HousekeepingStaff. `BulkUploadLogRead`/`BulkUploadUndoResponse`
below stay here and get extended in place (`entity_type`,
`not_reverted_count`) since they back the 4 shared, entity-agnostic
endpoints in `app/api/v1/routers/sanctioned_strength.py`. The per-entity
row-preview/validation/commit shapes, by contrast, get their own sibling
schema modules (`app/schemas/location_import.py`,
`app/schemas/housekeeping_staff_import.py`) rather than a generic row-preview
union reused here -- `BulkUploadRowPreview` below carries Sanctioned-
Strength-specific fields (department_name/designation_name/approved_strength/
effective_from) that don't apply to Location or HousekeepingStaff rows, and
this codebase's own stated preference (see the entity_type dispatch's own
"if/elif, not a registry" call) is explicit code over indirection at this
scale -- 3 known entity types, not an open-ended set.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.enums import BulkUploadEntityTypeEnum, BulkUploadStatusEnum

BulkUploadRowStatus = Literal["created", "updated", "unchanged", "rejected"]


class BulkUploadRowPreview(BaseModel):
    row_number: int
    status: BulkUploadRowStatus
    error_reason: str | None = None
    campus_code: str | None = None
    department_name: str | None = None
    designation_name: str | None = None
    approved_strength: int | None = None
    effective_from: date | None = None
    remarks: str | None = None


class BulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[BulkUploadRowPreview]


class BulkUploadCommitResponse(BulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID


class BulkUploadLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    entity_type: BulkUploadEntityTypeEnum
    uploaded_by_id: uuid.UUID
    uploaded_at: datetime
    rows_total: int
    rows_created: int
    rows_updated: int
    rows_rejected: int
    stored_file_object_key: str | None
    status: BulkUploadStatusEnum
    undo_deadline: datetime
    undone_at: datetime | None
    undone_by_id: uuid.UUID | None


class BulkUploadUndoResponse(BaseModel):
    id: uuid.UUID
    status: BulkUploadStatusEnum
    reverted_history_count: int
    # Phase J -- always 0 for Sanctioned Strength's own undo (every touched
    # row has a real SanctionedStrengthHistory.old_value to replay). Real
    # (> 0) for Location/HousekeepingStaff batches whose undo skips rows
    # this batch *updated* rather than created -- see
    # app/models/bulk_upload_row_log.py's docstring for why those can't be
    # automatically reverted.
    not_reverted_count: int = 0
