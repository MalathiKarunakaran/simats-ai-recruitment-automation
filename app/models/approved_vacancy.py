import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base


class ApprovedVacancy(Base):
    __tablename__ = "approved_vacancies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    vacancy_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vacancy_requests.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    # Denormalized from vacancy_request.campus_id -- same rationale as
    # User.campus_id / Application.campus_id: cheap scope filtering without a join.
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    total_positions: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    vacancy_request: Mapped["VacancyRequest"] = relationship(back_populates="approved_vacancy")
    campus: Mapped["Campus"] = relationship()
    hiring_slots: Mapped[list["HiringSlot"]] = relationship(back_populates="approved_vacancy")
    job_posting: Mapped["JobPosting"] = relationship(back_populates="approved_vacancy", uselist=False)

    def __repr__(self) -> str:
        return f"<ApprovedVacancy {self.id} ({self.total_positions} positions)>"
