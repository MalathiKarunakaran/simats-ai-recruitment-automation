"""Response shapes for the Vacancy Request bulk upload (2026-08-30).

Mirrors `app/schemas/location_import.py` field-for-field so the frontend's
shared bulk-upload dialog can render this entity with no special-casing --
including `updated_count` and `unchanged_count`, which are ALWAYS 0 here
because this importer is create-only. See
`app/services/vacancy_request_import.py` for why a vacancy request must not be
upserted.
"""

import uuid
from datetime import date

from pydantic import BaseModel


class VacancyRequestBulkUploadRowPreview(BaseModel):
    row_number: int
    # "created" or "rejected" only -- never "updated"/"unchanged".
    status: str
    error_reason: str | None = None
    campus_code: str | None = None
    department_name: str | None = None
    designation_name: str | None = None
    requested_count: int | None = None
    priority: str | None = None
    required_by: date | None = None
    justification: str | None = None
    # Optional referrer details. Echoed back on rejected rows too, so the
    # preview shows what was typed rather than blanking it.
    requester_name: str | None = None
    requester_email: str | None = None
    requester_mobile: str | None = None


class VacancyRequestBulkUploadValidationResponse(BaseModel):
    total: int
    created_count: int
    # Always 0 -- present for shape parity with the five master-data
    # importers, not because they can ever be non-zero.
    updated_count: int
    unchanged_count: int
    rejected_count: int
    rows: list[VacancyRequestBulkUploadRowPreview]


class VacancyRequestBulkUploadCommitResponse(VacancyRequestBulkUploadValidationResponse):
    bulk_upload_log_id: uuid.UUID
    # Non-null ONLY when the rows committed but the original workbook's
    # archival copy failed after retries -- a non-blocking warning, never a
    # reason the commit failed. See app/services/storage.py.
    storage_warning: str | None = None
