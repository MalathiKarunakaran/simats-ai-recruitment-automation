"""App-owned marks on a provisional order's checklist
(docs/specs/joining-screens.md, Step A2). Written only by
`services/provisional_order_marks.py`; the sheet sync never reads or writes
this table, so a sync cannot overwrite an app mark.

One row per provisional order. Every value column is nullable and NULL
means "use the sheet's value" -- the effective value everywhere is
COALESCE(mark, sheet). Two items have no sheet column at all (the
Registrar's final appointment order, orientation), so for them NULL simply
means "not yet".

Who/when is kept per field in `marked` ({field: {by_user_id, by_name, at}})
rather than as two columns per field: twelve markable fields would need 24
more columns (and 12 user FKs) for data that is only ever displayed next to
its value and never filtered on. The name is a snapshot so the note still
reads right if the user is renamed or removed; the full history is in the
audit log, one row per change.

`order_status` and `outcome` are plain strings with CHECK constraints (no
Postgres enum), so the migration downgrades with a clean drop.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.sheet_sync import (
    ORDER_ISSUED,
    ORDER_PENDING,
    OUTCOME_NOT_RECOMMENDED,
    OUTCOME_PERMANENT_ORDER_RECEIVED,
    OUTCOME_PROBATION_EXTENDED,
)

# Outcomes the sheet writes but the sync does not normalise (they arrive as
# `outcome_raw` only). An app mark can record them as their own values.
OUTCOME_LEFT = "LEFT"
OUTCOME_REJOIN = "REJOIN"
OUTCOME_TRA = "TRA"
OUTCOME_FAMILY_WAY = "FAMILY_WAY"
OUTCOME_NO_SUBMIT_PG = "NO_SUBMIT_PG"
OUTCOME_LONG_LEAVE = "LONG_LEAVE"

MARK_ORDER_STATUSES = (ORDER_ISSUED, ORDER_PENDING)
MARK_OUTCOMES = (
    OUTCOME_PERMANENT_ORDER_RECEIVED,
    OUTCOME_PROBATION_EXTENDED,
    OUTCOME_NOT_RECOMMENDED,
    OUTCOME_LEFT,
    OUTCOME_REJOIN,
    OUTCOME_TRA,
    OUTCOME_FAMILY_WAY,
    OUTCOME_NO_SUBMIT_PG,
    OUTCOME_LONG_LEAVE,
)

# Every markable field, in display order.
MARK_FIELDS = (
    "id_card_done",
    "food_app_done",
    "arms_done",
    "app_360_done",
    "adfa_file_done",
    "room_allotted",
    "order_status",
    "outcome",
    "registrar_order_issued",
    "registrar_order_date",
    "orientation_conducted",
    "orientation_date",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IS NULL OR {column} IN ({', '.join(repr(v) for v in values)})"


class ProvisionalOrderMark(Base):
    __tablename__ = "provisional_order_marks"
    __table_args__ = (
        UniqueConstraint("provisional_order_id", name="uq_provisional_order_marks_provisional_order_id"),
        CheckConstraint(_in("order_status", MARK_ORDER_STATUSES), name="ck_provisional_order_marks_order_status"),
        CheckConstraint(_in("outcome", MARK_OUTCOMES), name="ck_provisional_order_marks_outcome"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    provisional_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provisional_orders.id", ondelete="CASCADE"),
        nullable=False,
    )

    id_card_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    food_app_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    arms_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    app_360_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    adfa_file_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    room_allotted: Mapped[str | None] = mapped_column(String(255), nullable=True)
    order_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    registrar_order_issued: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    registrar_order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    orientation_conducted: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    orientation_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    marked: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
