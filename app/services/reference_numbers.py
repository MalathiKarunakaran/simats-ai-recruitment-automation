"""Human-facing reference numbers for the requisition and the posting.

Same shape and same reasoning as `vacancy_request_intake._next_request_ref`
(VR-2026-000123): derived by counting this year's existing numbers rather
than from a database sequence, because a sequence would drift from the
year-prefixed format at the first year roll-over. Uniqueness is guaranteed
by the column's unique constraint, not here -- this only produces a good
first guess, and the callers run inside the same transaction that inserts
the row, so a race surfaces as an IntegrityError rather than a duplicate.

RQ = recruitment requisition (`ApprovedVacancy`), JP = job posting.
"""

from datetime import date, datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.approved_vacancy import ApprovedVacancy
from app.models.job_posting import JobPosting

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
