import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import BulkUploadStatusEnum


class BulkUploadLog(Base):
    """One row per Sanctioned Strength bulk-upload commit (Phase F) --
    summarizes the batch (row-status counts) and anchors "undo last upload"
    within a 24h window: every SanctionedStrengthHistory row this batch
    touched carries this row's id (SanctionedStrengthHistory.bulk_upload_log_id),
    which is what lets undo revert them without any other new
    infrastructure."""

    __tablename__ = "bulk_upload_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    rows_total: Mapped[int] = mapped_column(Integer, nullable=False)
    rows_created: Mapped[int] = mapped_column(Integer, nullable=False)
    rows_updated: Mapped[int] = mapped_column(Integer, nullable=False)
    rows_rejected: Mapped[int] = mapped_column(Integer, nullable=False)
    # MinIO object key for the originally-uploaded file -- populated once
    # Phase F wires the new MINIO_BUCKET_BULK_UPLOADS bucket; NULL until
    # then (this phase creates the column only, no storage wiring).
    stored_file_object_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[BulkUploadStatusEnum] = mapped_column(
        Enum(BulkUploadStatusEnum, name="bulk_upload_status_enum"),
        nullable=False,
        default=BulkUploadStatusEnum.COMPLETED,
    )
    # uploaded_at + 24h, computed and stored by the Phase F commit endpoint
    # at write time (deliberately not a DB-generated column, so the 24h
    # window is pinned to the exact moment of commit).
    undo_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    undone_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    uploaded_by: Mapped["User"] = relationship(foreign_keys=[uploaded_by_id])
    undone_by: Mapped["User"] = relationship(foreign_keys=[undone_by_id])

    def __repr__(self) -> str:
        return f"<BulkUploadLog {self.filename} ({self.status})>"
