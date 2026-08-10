"""Sanctioned Strength: the single reusable "current-effective row"
resolution rule (zany-snuggling-pie.md's Context section, decision 2 /
Phase A). Every later read path -- the Vacancy Register rewrite (Phase B),
the availability strip's `available_to_request` computation and
`vacancy_workflow.py::submit()`'s enforcement (Phase E), the designation
breakdown (Phase B), and bulk-upload UPSERT targeting (Phase F) -- must
resolve "what is the current sanctioned strength for this key" through the
functions in this module rather than reimplementing the rule per call site.

Rule: the "current" SanctionedStrength row for a given
(campus_id, department_id, designation_id) key is the row with the latest
`effective_from <= as_of` (default: today) among that key's `is_active=true`
rows. Future-dated rows (`effective_from > as_of`) and inactive rows
(`is_active=false`) are never "current", regardless of how recent they are.

Implemented as a Postgres `SELECT DISTINCT ON (...)` -- SQLAlchemy 2.0's
`Select.distinct(*cols)` generates exactly this when compiled against the
postgresql dialect, ordered so the DISTINCT ON columns are the leading
ORDER BY columns (required for correct DISTINCT ON semantics) followed by
`effective_from DESC` to pick the latest-dated qualifying row per key.
"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sanctioned_strength import SanctionedStrength


def current_effective_rows(
    db: Session,
    *,
    campus_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
    designation_id: uuid.UUID | None = None,
    as_of: date | None = None,
) -> list[SanctionedStrength]:
    """Resolve the current-effective SanctionedStrength row(s) matching the
    given (optional, AND-combined) filters.

    All three key filters are optional so this one function serves every
    granularity a caller needs:
    - all three set -> the single current row for one (campus, department,
      designation) key (0 or 1 rows returned).
    - only `department_id` set -> one current row per designation currently
      sanctioned within that department (the designation breakdown's shape).
    - only `campus_id` set (or no filters at all) -> one current row per
      (department, designation) key campus-wide (or system-wide) -- the
      Vacancy Register rewrite's `approved_count` aggregate shape.

    `as_of` defaults to today; pass an explicit date to resolve "what was
    sanctioned as of <date>" for reporting/history use cases.

    Returns one `SanctionedStrength` ORM row per distinct
    (campus_id, department_id, designation_id) key matching the filters --
    never more than one row per key, by construction of the DISTINCT ON.
    """
    resolve_date = as_of or date.today()

    stmt = (
        select(SanctionedStrength)
        .distinct(
            SanctionedStrength.campus_id,
            SanctionedStrength.department_id,
            SanctionedStrength.designation_id,
        )
        .where(
            SanctionedStrength.is_active.is_(True),
            SanctionedStrength.effective_from <= resolve_date,
        )
        .order_by(
            SanctionedStrength.campus_id,
            SanctionedStrength.department_id,
            SanctionedStrength.designation_id,
            SanctionedStrength.effective_from.desc(),
        )
    )
    if campus_id is not None:
        stmt = stmt.where(SanctionedStrength.campus_id == campus_id)
    if department_id is not None:
        stmt = stmt.where(SanctionedStrength.department_id == department_id)
    if designation_id is not None:
        stmt = stmt.where(SanctionedStrength.designation_id == designation_id)

    return list(db.execute(stmt).scalars().all())


def current_effective_row(
    db: Session,
    *,
    campus_id: uuid.UUID,
    department_id: uuid.UUID,
    designation_id: uuid.UUID,
    as_of: date | None = None,
) -> SanctionedStrength | None:
    """Single-key convenience wrapper over `current_effective_rows` for the
    common "resolve one (campus, department, designation) key" call shape
    (Phase E's availability strip / `submit()`-time enforcement). Returns
    `None` if this key has never been sanctioned, or every row for it is
    future-dated / inactive as of `as_of`."""
    rows = current_effective_rows(
        db,
        campus_id=campus_id,
        department_id=department_id,
        designation_id=designation_id,
        as_of=as_of,
    )
    return rows[0] if rows else None
