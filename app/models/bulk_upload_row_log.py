import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import BulkUploadEntityTypeEnum


class BulkUploadRowLog(Base):
    """One row per non-rejected row committed by a Location or
    HousekeepingStaff bulk upload (Phase J, glowing-zooming-hamming.md) --
    NOT written for Sanctioned Strength imports, which keep using their own
    pre-existing `SanctionedStrengthHistory` mechanism unchanged (no dual
    write).

    Why this table exists at all: Sanctioned Strength's own undo works
    because `SanctionedStrengthHistory.old_value` is a permanent record of
    what the row looked like *before* the batch touched it, written at
    commit time. Location and HousekeepingStaff have no equivalent history
    table. Re-deriving "did this batch create or update this row" by
    re-validating the originally-stored file against *current* DB state
    (the way `download_bulk_upload_error_report` re-validates for its own,
    read-only purpose) does NOT work for undo: by the time undo runs, the
    row the batch created now exists, so re-validation would find it and
    misclassify it as "existing" -- silently breaking the created-vs-updated
    distinction undo depends on. So this table records that distinction
    directly, once, at the moment of commit, rather than trying to
    reconstruct it later.

    `undo_bulk_upload` (app/api/v1/routers/sanctioned_strength.py) uses this
    table, for LOCATION/HOUSEKEEPING_STAFF batches only, to soft-delete
    (`is_active=False`) every row this batch *created* (`was_created=True`).
    Rows this batch *updated* (`was_created=False`) cannot be automatically
    reverted -- there is no stored prior value to restore -- and are skipped,
    surfaced via `BulkUploadUndoResponse.not_reverted_count`.
    """

    __tablename__ = "bulk_upload_row_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    bulk_upload_log_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bulk_upload_log.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_type: Mapped[BulkUploadEntityTypeEnum] = mapped_column(
        Enum(BulkUploadEntityTypeEnum, name="bulk_upload_entity_type_enum"),
        nullable=False,
    )
    # Not a real FK -- entity_id points at whichever table `entity_type`
    # names (locations.id or housekeeping_staff.id), and a single column
    # can't carry two different FK targets. Same "polymorphic reference,
    # resolved in application code, not the DB" trade-off AuditLog.entity_id
    # already makes for the same reason.
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    was_created: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bulk_upload_log: Mapped["BulkUploadLog"] = relationship()

    def __repr__(self) -> str:
        return f"<BulkUploadRowLog {self.entity_type} {self.entity_id} created={self.was_created}>"
