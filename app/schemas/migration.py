import uuid
from typing import Literal

from pydantic import BaseModel


class MigrationRowResult(BaseModel):
    row_number: int
    status: Literal["created", "error"]
    vacancy_request_id: uuid.UUID | None
    errors: list[str]


class MigrationImportResponse(BaseModel):
    total_rows: int
    created_count: int
    error_count: int
    rows: list[MigrationRowResult]
