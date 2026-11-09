from typing import Literal

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


class ResumeClues(BaseModel):
    """What the script found in the resume, as clues rather than conclusions.
    Never the address or the text: a PIN, one state word, a title. The server
    decides what they mean (services/talent_pool_inference.py). The `contact_*`
    pair comes from an unlabelled contact block and is ignored unless
    ACCEPT_CONTACT_BLOCK_STATE is switched on."""

    gender_field: str | None = Field(None, max_length=20)
    honorific: str | None = Field(None, max_length=40)
    home_pin: str | None = Field(None, max_length=12)
    home_state_word: str | None = Field(None, max_length=60)
    contact_pin: str | None = Field(None, max_length=12)
    contact_state_word: str | None = Field(None, max_length=60)
    nationality_indian: bool = False


class ResumeFieldsItem(BaseModel):
    """Two shapes. The original (gender/state/country, already decided by the
    script) is still accepted unchanged. With `clues` the server infers the
    values itself and `gender`/`state`/`country` are ignored."""

    file_id: str = Field(min_length=1, max_length=200)
    gender: Literal["Male", "Female"] | None = None
    state: str | None = Field(None, max_length=100)
    country: str | None = Field(None, max_length=100)
    resume_hash: str | None = Field(None, min_length=1, max_length=64)
    clues: ResumeClues | None = None


class ResumeFieldsRequest(BaseModel):
    items: list[ResumeFieldsItem] = Field(max_length=MAX_SYNC_ROWS)


class ResumeFieldsResult(BaseModel):
    received: int
    saved: int
    no_matching_candidate: int
    processed: int = 0
    state_filled: int = 0
    gender_filled: int = 0
    skipped: int = 0
    errors: int = 0


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
