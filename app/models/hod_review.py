"""HOD review of an in-app hire on probation
(docs/specs/hod-review-and-permanent-order.md). Written only by
`services/hod_reviews.py`.

Several reviews may be recorded for one application; every one is kept as
history and the latest is the one shown. Only a RECOMMEND_PERMANENT review
moves the application on (to HOD_REVIEW_COMPLETE); EXTEND_PROBATION carries
the new probation end date, which then wins over the provisional order's.

`recommendation` is a plain string with a CHECK constraint (values from
`HodRecommendationEnum`), so the migration downgrades with a clean drop.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base


class HodReview(Base):
    __tablename__ = "hod_reviews"
    __table_args__ = (
        CheckConstraint(
            "recommendation IN ('RECOMMEND_PERMANENT', 'EXTEND_PROBATION', 'NOT_RECOMMENDED')",
            name="ck_hod_reviews_recommendation",
        ),
        CheckConstraint(
            "recommendation <> 'EXTEND_PROBATION' OR new_probation_end_date IS NOT NULL",
            name="ck_hod_reviews_extend_has_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Denormalized from the application for campus scoping.
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Typed, like Application.hod_assigned (there is no HOD user per
    # department); the form prefills it from hod_assigned.
    hod_name: Mapped[str] = mapped_column(String(150), nullable=False)
    review_date: Mapped[date] = mapped_column(Date, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(30), nullable=False)
    new_probation_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Signed review (optional), stored like the joining documents.
    file_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    recorded_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()  # noqa: F821
