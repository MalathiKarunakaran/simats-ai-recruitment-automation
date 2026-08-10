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

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.models.department import Department
from app.models.designation import Designation
from app.models.employee import Employee
from app.models.enums import EmploymentStatusEnum
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


def list_department_designation_breakdown(db: Session, department_id: uuid.UUID) -> list[dict]:
    """One row per Designation relevant to `department_id` -- the Vacancy
    Register's expandable-row breakdown (Phase B/C). `approved` comes from
    `current_effective_rows` (this module's own resolver, not reimplemented);
    `working` is a live COUNT(Employee) scoped to (department_id,
    designation_id, employment_status == ACTIVE) -- accurate now that
    Employee has a real `designation_id` FK (Phase A backfill); `vacancy` is
    `max(approved - working, 0)`, the same floor-at-zero convention as the
    register's own vacancy_count.

    A designation is "relevant" to this department if either:
    (a) it's linked to the department via the `designation_departments` M2M
    table Designation Master's own UI manages, or
    (b) it has at least one `sanctioned_strength` row for this specific
    department (any `effective_from`/`is_active` state -- not just
    current-effective), which happens when the "Add designation" UI creates a
    sanctioned-strength row for a designation not yet M2M-linked to the
    department. This is purely about which designations this read query
    considers -- it never writes to `designation_departments` itself, that
    stays Designation Master's own domain.

    Designations with no current-effective sanctioned row for this
    department still appear (approved=0), so a department can see every
    designation relevant to it, not just the ones with a current sanction.
    """
    designations = (
        db.query(Designation)
        .filter(
            or_(
                Designation.departments.any(Department.id == department_id),
                exists().where(
                    SanctionedStrength.designation_id == Designation.id,
                    SanctionedStrength.department_id == department_id,
                ),
            )
        )
        .order_by(Designation.name)
        .all()
    )
    if not designations:
        return []

    current_rows_by_designation = {
        row.designation_id: row for row in current_effective_rows(db, department_id=department_id)
    }

    working_by_designation = dict(
        db.query(Employee.designation_id, func.count(Employee.id))
        .filter(
            Employee.department_id == department_id,
            Employee.designation_id.isnot(None),
            Employee.employment_status == EmploymentStatusEnum.ACTIVE,
        )
        .group_by(Employee.designation_id)
        .all()
    )

    rows: list[dict] = []
    for designation in designations:
        current_row = current_rows_by_designation.get(designation.id)
        approved = current_row.approved_strength if current_row is not None else 0
        working = working_by_designation.get(designation.id, 0)
        rows.append(
            {
                "designation_id": designation.id,
                "designation_name": designation.name,
                "sanctioned_strength_id": current_row.id if current_row is not None else None,
                "approved": approved,
                "working": working,
                "vacancy": max(approved - working, 0),
            }
        )
    return rows


def working_count_for(db: Session, *, department_id: uuid.UUID, designation_id: uuid.UUID) -> int:
    """Live COUNT(Employee) for one (department, designation) key -- shared by
    the breakdown above and the sanctioned_strength router's soft-delete
    block (item 7: "N active employees in this designation, cannot delete")
    so the two never compute this figure differently."""
    return (
        db.query(func.count(Employee.id))
        .filter(
            Employee.department_id == department_id,
            Employee.designation_id == designation_id,
            Employee.employment_status == EmploymentStatusEnum.ACTIVE,
        )
        .scalar()
        or 0
    )
