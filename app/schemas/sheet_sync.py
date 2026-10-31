from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from app.schemas.talent_pool_sync import MAX_SYNC_COLUMNS, MAX_SYNC_ROWS


class SheetSyncSource(str, Enum):
    NEW_JOINEES = "NEW_JOINEES"
    PRO_APP_ORDER = "PRO_APP_ORDER"


class SheetSyncRow(BaseModel):
    row_number: int = Field(ge=1)
    cells: list[str | None] = Field(max_length=MAX_SYNC_COLUMNS)

    @field_validator("cells", mode="before")
    @classmethod
    def _cells_as_text(cls, value):
        if not isinstance(value, list):
            return value
        return [None if cell is None else str(cell) for cell in value]


class SheetSyncRequest(BaseModel):
    """One full snapshot of one tab. For New Joinees the caller sends the
    tab's header row (row 2) and the data rows beneath it."""

    headers: list[str | None] = Field(max_length=MAX_SYNC_COLUMNS)
    rows: list[SheetSyncRow] = Field(max_length=MAX_SYNC_ROWS)
    dry_run: bool = False


class SheetSyncFlag(BaseModel):
    row_number: int
    key: str | None
    reason: str


class SheetSyncResult(BaseModel):
    source: SheetSyncSource
    dry_run: bool
    run_id: str | None
    counts: dict[str, int]
    flagged: list[SheetSyncFlag]
    missing_headers: list[str]


class SheetSyncRunOut(BaseModel):
    id: str | None
    source: str
    dry_run: bool
    created_at: datetime | None
    counts: dict[str, int]
    missing_headers: list[str] = []


class SheetSyncStatusItem(BaseModel):
    source: str
    last_run: SheetSyncRunOut | None
    last_dry_run: SheetSyncRunOut | None
