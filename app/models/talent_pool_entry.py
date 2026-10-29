"""Talent pool (2026-10-23), Step A of docs/specs/talent-pool-dashboard.md.

One row per candidate read out of the recruitment Google Sheet. This table
is a *mirror of that sheet*, not a recruitment record: nothing in the app
edits it, the dashboard over it is read-only, and the sheet stays the system
of record until someone explicitly moves an entry into an `Application`
(a later step, which is why `application_id` is nullable and only ever
means "this pool entry became that application").

Two things about the column types are deliberate and worth not undoing.

`source_tab` is a native Postgres enum because it is structural -- the two
tabs carry different columns, and a third would be a new sheet. But
`sheet_status`, `eligibility` and every department/source/called_by column
beside it are PLAIN STRINGS, even though the spec lists their expected
values. That asymmetry is the point: those values are transcribed from a
spreadsheet people edit by hand, so an unexpected spelling has to land in
the table where it can be seen and corrected. A Postgres enum would instead
reject the write and lose the row, and losing a candidate to a typo in a
status cell is a far worse failure than showing an unexpected status on a
dashboard. `app/models/enums.py`'s TALENT_POOL_* tuples therefore fix only
the display ORDER; a value outside them still appears, just last.

The natural key belongs to the sync that writes this table
(docs/specs/talent-pool-sheet-sync.md section 5, built 2026-10-29): it keys
on `row_key` -- person plus occurrence, not the sheet row number -- unique
per `source_tab`. Rows with no `row_key` were not written by the sync and it
leaves them alone.

`is_active = false` means the row is no longer in the sheet (the sync
deactivates rather than deletes, so a candidate removed by mistake is
recoverable and the dashboard can show "Removed from sheet"). Every read
filters it out unless `include_inactive` is asked for.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import TalentPoolSourceTabEnum


class TalentPoolEntry(Base):
    __tablename__ = "talent_pool_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    source_tab: Mapped[TalentPoolSourceTabEnum] = mapped_column(
        Enum(TalentPoolSourceTabEnum, name="talent_pool_source_tab_enum"),
        nullable=False,
        index=True,
    )

    # --- Who --------------------------------------------------------------
    # NOT NULL: an entry with no name cannot be shown, searched or acted on.
    # The sync is expected to SKIP such a sheet row and report it as skipped
    # rather than write a nameless row here (spec section 5, step E counts on
    # exactly that to explain any difference in totals).
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # --- Department, twice ------------------------------------------------
    # `dept_raw` is the cell exactly as typed (about 260 spellings);
    # `dept_group` is the normalised bucket it counts under (about 33). Both
    # are kept because the dashboard offers a Grouped / As-in-sheet toggle,
    # and because the grouping is OUR interpretation -- keeping the original
    # means a mis-grouping is always traceable back to what the sheet said.
    dept_raw: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    dept_group: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # NTS only: the post the candidate applied for.
    applied_post: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Teaching reads Applied Date; NTS reads Call / Mail Sent Date, falling
    # back to the interview date. A Date, not a timestamp: the sheet records
    # a day, and pretending to a time nobody typed would make the monthly
    # chart depend on a timezone.
    applied_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)

    # --- Outcome ----------------------------------------------------------
    sheet_status: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # True when the status was inferred from a free-text remark rather than
    # read from a status cell. Surfaced in the register as a muted "from
    # remark" note, so a reader can tell a recorded decision from a guess.
    status_from_remark: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Teaching only; NULL on NTS rows (which have no PhD question).
    eligibility: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    eligibility_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Kept as the raw string, not a Date: these cells hold things like
    # "12/13-9-25" and "after Pongal", and a parse that quietly failed would
    # be worse than showing what was written.
    interview_on_raw: Mapped[str | None] = mapped_column(String(100), nullable=True)
    called_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    resume_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Set only when a pool entry has been promoted into the real pipeline.
    # SET NULL, like the mail log's links out: losing the link is survivable,
    # and the pool entry must not block deleting an application.
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- Sync bookkeeping -------------------------------------------------
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    # 1-based row in the sheet tab, for "Sheet row N" in the entry sheet.
    sheet_row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Every column of the sheet row as header -> value. The entry sheet's
    # "All columns" section renders this, so a column nobody modelled is
    # still visible to a human instead of being silently dropped.
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # Digest of the sheet row, so a sync can tell unchanged rows from edited
    # ones without comparing every column. Written by the sync; reads ignore
    # it and the list endpoint deliberately does not return it.
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # The sync's identity for this row (2026-10-29, migration 3e5f7a9c1b2d):
    # a digest of who the candidate is (email, else name + phone digits) and
    # which repeat of them this is, in sheet order -- so a re-sorted sheet or
    # an inserted row keeps every row's identity, which a row number would
    # not. NULL on rows the sync did not write (hand-entered ones), and the
    # sync never touches those: unique together with source_tab, NULLs apart.
    row_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application | None"] = relationship()  # noqa: F821

    # Composite indexes matching the three shapes every read actually has.
    # Every query filters (source_tab, is_active) first, so a bare index on
    # either column alone would not be used; the aggregations then group by
    # status, department or eligibility, and the register sorts by applied_on.
    __table_args__ = (
        UniqueConstraint("source_tab", "row_key", name="uq_talent_pool_tab_row_key"),
        Index("ix_talent_pool_tab_active_status", "source_tab", "is_active", "sheet_status"),
        Index("ix_talent_pool_tab_active_dept", "source_tab", "is_active", "dept_group"),
        Index("ix_talent_pool_tab_active_elig", "source_tab", "is_active", "eligibility"),
        Index("ix_talent_pool_tab_active_applied", "source_tab", "is_active", "applied_on"),
    )

    @property
    def in_pipeline(self) -> bool:
        """Whether this entry has been promoted into a real Application."""
        return self.application_id is not None

    def __repr__(self) -> str:
        return f"<TalentPoolEntry {self.full_name} tab={self.source_tab} status={self.sheet_status}>"
