"""Provisional appointment order for an in-app hire
(docs/specs/provisional-order-and-allotment.md).

Named `appointment_orders` so it cannot be confused with `provisional_orders`,
the read-only mirror of the sheet register. Written only by
`services/appointment_orders.py`.

The letter fields are a SNAPSHOT taken when the order is issued, so a
reprinted letter says exactly what the first one said even if the candidate,
the vacancy or the campus details change later. Status is a plain string
(like selection batches), so nothing irreversible is added to Postgres and
the migration downgrades with a clean drop.

`sequence` is the running number PER CAMPUS that never restarts by year
(continuing the paper register -- see `reference_numbers`); the pair
(campus_id, sequence) and the formatted `order_number` are both unique, and
those constraints, not the generator, are the guarantee.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

APPOINTMENT_ORDER_ISSUED = "ISSUED"
APPOINTMENT_ORDER_CANCELLED = "CANCELLED"


class AppointmentOrder(Base):
    __tablename__ = "appointment_orders"
    __table_args__ = (
        UniqueConstraint("order_number", name="uq_appointment_orders_order_number"),
        UniqueConstraint("campus_id", "sequence", name="uq_appointment_orders_campus_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Denormalized from the application for campus scoping, and the key the
    # running number is counted per.
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    order_number: Mapped[str] = mapped_column(String(64), nullable=False)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=APPOINTMENT_ORDER_ISSUED, index=True)
    issued_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # --- Letter snapshot ---------------------------------------------------
    candidate_name: Mapped[str] = mapped_column(String(150), nullable=False)
    # As printed under the name ("To, <Name>., <Address>"); NULL omits the line.
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    designation: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    campus_code: Mapped[str] = mapped_column(String(10), nullable=False)
    college_name: Mapped[str] = mapped_column(String(200), nullable=False)
    principal_name: Mapped[str] = mapped_column(String(150), nullable=False)
    department_name: Mapped[str] = mapped_column(String(150), nullable=False)
    joining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    probation_end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # --- Signed copy -------------------------------------------------------
    signed_copy_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    signed_copy_content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    signed_copy_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signed_copy_uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    signed_copy_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()  # noqa: F821
