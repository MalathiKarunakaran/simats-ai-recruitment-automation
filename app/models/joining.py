import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import JoiningDocumentStatusEnum


class JoiningRecord(Base):
    __tablename__ = "joining_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    # Copied from the accepted Offer.joining_date at creation time.
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_joining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    onboarding_completed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()

    def __repr__(self) -> str:
        return f"<JoiningRecord {self.application_id}>"


class JoiningDocument(Base):
    __tablename__ = "joining_documents"
    __table_args__ = (UniqueConstraint("application_id", "document_type", name="uq_joining_document_application_type"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Plain string -- see the comment in app/models/enums.py next to
    # DEFAULT_JOINING_DOCUMENT_TYPES for why this isn't a DB enum.
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[JoiningDocumentStatusEnum] = mapped_column(
        Enum(JoiningDocumentStatusEnum, name="joining_document_status_enum"),
        nullable=False,
        default=JoiningDocumentStatusEnum.PENDING,
    )
    # Metadata-only stub -- MinIO wiring is Phase 3. No upload endpoint yet.
    storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()

    def __repr__(self) -> str:
        return f"<JoiningDocument {self.document_type} ({self.status})>"
