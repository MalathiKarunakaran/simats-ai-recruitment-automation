import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import HiringSlotStatusEnum


class HiringSlot(Base):
    __tablename__ = "hiring_slots"
    __table_args__ = (
        UniqueConstraint("approved_vacancy_id", "slot_number", name="uq_hiring_slot_vacancy_number"),
        # One slot per application, enforced at the DB level (not just app logic).
        Index(
            "uq_hiring_slot_reserved_application",
            "reserved_application_id",
            unique=True,
            postgresql_where="reserved_application_id IS NOT NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    approved_vacancy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("approved_vacancies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    slot_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[HiringSlotStatusEnum] = mapped_column(
        Enum(HiringSlotStatusEnum, name="hiring_slot_status_enum"),
        nullable=False,
        default=HiringSlotStatusEnum.OPEN,
        index=True,
    )
    reserved_application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    approved_vacancy: Mapped["ApprovedVacancy"] = relationship(back_populates="hiring_slots")
    reserved_application: Mapped["Application"] = relationship()

    def __repr__(self) -> str:
        return f"<HiringSlot {self.approved_vacancy_id}#{self.slot_number} ({self.status})>"
