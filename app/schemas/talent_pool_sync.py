from pydantic import BaseModel, Field, field_validator

from app.models.enums import TalentPoolSourceTabEnum

# Generous ceilings, far above today's tabs (Final ~7,800 rows, 19 columns),
# so a malformed payload is refused instead of read in full.
MAX_SYNC_ROWS = 50_000
MAX_SYNC_COLUMNS = 100


class TalentPoolSyncRow(BaseModel):
    row_number: int = Field(ge=1)
    cells: list[str | None] = Field(max_length=MAX_SYNC_COLUMNS)

    # The Google Sheets node may send numbers for numeric-looking cells
    # (a phone, an S.No); everything is kept as the text the sheet shows.
    @field_validator("cells", mode="before")
    @classmethod
    def _cells_as_text(cls, value):
        if not isinstance(value, list):
            return value
        return [None if cell is None else str(cell) for cell in value]


class TalentPoolSyncRequest(BaseModel):
    """One full snapshot of one tab (docs/specs/talent-pool-sheet-sync.md
    section 2). n8n does no logic: the app works out what changed."""

    source_tab: TalentPoolSourceTabEnum
    sheet_last_update: str | None = Field(None, max_length=100)
    headers: list[str | None] = Field(max_length=MAX_SYNC_COLUMNS)
    rows: list[TalentPoolSyncRow] = Field(max_length=MAX_SYNC_ROWS)


class SyncRowNote(BaseModel):
    row_number: int
    reason: str


class SyncDuplicate(BaseModel):
    row_number: int
    same_as_row: int


class TalentPoolSyncResult(BaseModel):
    """Also written as the TALENT_POOL_SYNCED audit row's after_state, which
    the summary endpoint reads back. `counts` holds integers only, because
    that reader drops anything else; the lists are capped at 200 each."""

    source_tab: TalentPoolSourceTabEnum
    sheet_last_update: str | None
    counts: dict[str, int]
    skipped_rows: list[SyncRowNote]
    duplicate_rows: list[SyncDuplicate]
    unmapped_departments: list[str]
    missing_headers: list[str]
    notes: list[SyncRowNote]
