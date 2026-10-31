"""Human-facing reference numbers for the requisition and the posting.

Same shape and same reasoning as `vacancy_request_intake._next_request_ref`
(VR-2026-000123): derived by counting this year's existing numbers rather
than from a database sequence, because a sequence would drift from the
year-prefixed format at the first year roll-over. Uniqueness is guaranteed
by the column's unique constraint, not here -- this only produces a good
first guess, and the callers run inside the same transaction that inserts
the row, so a race surfaces as an IntegrityError rather than a duplicate.

RQ = recruitment requisition (`ApprovedVacancy`), JP = job posting. The
provisional appointment order number at the bottom follows a different
rule (per campus, never restarting) -- see its own comment.
"""

from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.appointment_order import AppointmentOrder
from app.models.approved_vacancy import ApprovedVacancy
from app.models.job_posting import JobPosting
from app.models.sheet_sync import OrderRegisterEntry

_SEQUENCE_WIDTH = 6


def _next(db: Session, column, prefix: str, today: date | None) -> str:
    year = (today or datetime.now(timezone.utc).date()).year
    year_prefix = f"{prefix}-{year}-"
    used = db.query(func.count(column)).filter(column.like(f"{year_prefix}%")).scalar() or 0
    return f"{year_prefix}{used + 1:0{_SEQUENCE_WIDTH}d}"


def next_requisition_number(db: Session, *, today: date | None = None) -> str:
    return _next(db, ApprovedVacancy.requisition_number, "RQ", today)


def next_posting_number(db: Session, *, today: date | None = None) -> str:
    return _next(db, JobPosting.posting_number, "JP", today)


# --- Provisional appointment order numbers ----------------------------------
# Format from the user's letters (31-Oct-2026): "SSE / PA/ 231/ 10/ 2026" --
# college code as printed, a 3-digit running number PER CAMPUS that does NOT
# restart by year (SSE ran 001 -> 230 across 2025-2026), then the order's
# month (2 digits) and year. Unlike RQ/JP above, the number continues the
# user's paper/sheet register, which is still in use: the next number is one
# past whichever is higher, the app's own last number or the register's.
#
# Last number in the register, per campus code, as of 31-Oct-2026. Now only
# the FALLBACK: `register_floor` prefers the synced register (ORDER_REGISTER)
# and uses these when no synced rows exist for the campus yet -- first deploy,
# or the sync not having run -- so numbering never restarts from 1.
PROVISIONAL_ORDER_FLOORS: dict[str, int] = {
    "SSE": 230,
    "SCLAS": 27,
    "SCAD": 22,
    "STUDIO": 9,
    "SSPE": 3,
    "SHOTS": 3,
    "SPIER": 1,
}


def register_floor(db: Session, campus_code: str) -> int:
    """The last order number the register shows for this campus at the time
    of issuing. The ONE place the register is consulted: the highest order_seq
    among ACTIVE synced register rows for the campus, else the constant above
    (campuses not listed there start from 0)."""
    code = campus_code.upper()
    synced = db.execute(
        select(func.max(OrderRegisterEntry.order_seq)).where(
            OrderRegisterEntry.campus_code == code, OrderRegisterEntry.is_active.is_(True)
        )
    ).scalar()
    if synced is not None:
        return synced
    return PROVISIONAL_ORDER_FLOORS.get(code, 0)


def next_provisional_order_number(
    db: Session, *, campus_id, campus_code: str, printed_code: str, order_date: date
) -> tuple[int, str]:
    """(sequence, formatted number) for the next order on this campus:
    max(highest app-issued sequence, register_floor) + 1. Called in the same
    transaction as the insert; the (campus_id, sequence) unique constraint
    is the guarantee."""
    used = (
        db.query(func.max(AppointmentOrder.sequence)).filter(AppointmentOrder.campus_id == campus_id).scalar() or 0
    )
    sequence = max(used, register_floor(db, campus_code)) + 1
    number = f"{printed_code} / PA/ {sequence:03d}/ {order_date.month:02d}/ {order_date.year}"
    return sequence, number
