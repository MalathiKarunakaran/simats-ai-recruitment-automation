import uuid
from typing import Literal

from pydantic import BaseModel


class TrackerVacancyRowResult(BaseModel):
    row_number: int
    status: Literal["imported", "flagged"]
    errors: list[str]
    vacancy_request_id: uuid.UUID | None = None


class TrackerCandidateRowResult(BaseModel):
    row_number: int
    status: Literal["imported", "imported_with_warning", "flagged"]
    errors: list[str]
    application_id: uuid.UUID | None = None


class TrackerImportResponse(BaseModel):
    vacancy_total_rows: int
    vacancy_imported_count: int
    vacancy_flagged_count: int
    vacancy_rows: list[TrackerVacancyRowResult]
    candidate_total_rows: int
    candidate_imported_count: int
    candidate_flagged_count: int
    candidate_rows: list[TrackerCandidateRowResult]
