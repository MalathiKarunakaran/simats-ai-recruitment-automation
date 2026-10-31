"""Selection batches (docs/specs/selection-batches.md, pipeline brief Phase 3).

A batch is a list of Talent Pool people whose sheet status is Selected, sent
to the University for approval. Written only by
`services/selection_batches.py`. Status is a plain string (not a Postgres
enum) so nothing irreversible is added and the migration is a clean drop.

Members carry a SNAPSHOT of the list's columns taken when the batch is
created: the sheet keeps changing and the list the University received must
not. `talent_pool_entry_id` is RESTRICT because the snapshot is the record of
what was sent, so a pool entry that was sent must not silently vanish.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

BATCH_SENT_TO_UNIVERSITY = "SENT_TO_UNIVERSITY"
BATCH_UNIVERSITY_APPROVED = "UNIVERSITY_APPROVED"
BATCH_WITHDRAWN = "WITHDRAWN"
# A person in a batch with one of these statuses cannot be put in another.
BATCH_LIVE_STATUSES = (BATCH_SENT_TO_UNIVERSITY, BATCH_UNIVERSITY_APPROVED)


class SelectionBatch(Base):
    __tablename__ = "selection_batches"
    __table_args__ = (UniqueConstraint("batch_no", name="uq_selection_batches_batch_no"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    batch_no: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    campus_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    sent_on: Mapped[date] = mapped_column(Date, nullable=False)
    university_ref_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    university_approved_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus | None"] = relationship()  # noqa: F821
    members: Mapped[list["SelectionBatchMember"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", order_by="SelectionBatchMember.position"
    )


class SelectionBatchMember(Base):
    __tablename__ = "selection_batch_members"
    __table_args__ = (
        UniqueConstraint("batch_id", "talent_pool_entry_id", name="uq_selection_batch_member"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("selection_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    talent_pool_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("talent_pool_entries.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Order the people were picked in, so the list prints as it was built.
    position: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")

    # --- Snapshot taken at creation ---------------------------------------
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    qualification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Not in the sheet; always NULL today, kept because the list has the column.
    experience: Mapped[str | None] = mapped_column(String(100), nullable=True)
    panel_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Typed per person at creation; free text ("45,000", "As per norms").
    proposed_salary: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    batch: Mapped[SelectionBatch] = relationship(back_populates="members")
