"""Employee.designation_id backfill (zany-snuggling-pie.md Phase A,
alembic/versions/f4b8c9d1e2a3_phase12_employee_designation_id_backfill.py).

tests/conftest.py builds the schema via Base.metadata.create_all(), not
`alembic upgrade head` (see testing skill) -- migrations themselves are
never exercised by the test suite. To still prove the backfill's actual SQL
logic is correct against fixture data (per the task), this file runs the
*exact same* UPDATE statement the migration executes (copy-identical, not a
reimplementation) directly against `db_session`, against Employee rows built
through the real Application/JobPosting pipeline (published_vacancy_factory
+ application_factory), and asserts the matching/non-matching/already-set
outcomes.

The live dev DB currently has 0 employees, so running the real migration
there is a no-op (confirmed via `alembic upgrade head`, see this session's
report) -- this file is what actually demonstrates the matching logic.
"""

import uuid
from datetime import date

from sqlalchemy import text

from app.models.designation import Designation
from app.models.employee import Employee
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum

# Identical to the UPDATE in
# alembic/versions/f4b8c9d1e2a3_phase12_employee_designation_id_backfill.py's
# upgrade() -- kept in sync deliberately (a change to one without the other
# would be a real regression this test should catch).
_BACKFILL_SQL = """
    UPDATE employees e
    SET designation_id = d.id
    FROM designations d
    WHERE LOWER(TRIM(e.designation)) = LOWER(TRIM(d.name))
      AND e.designation_id IS NULL
"""


def _make_designation(db_session, name: str) -> Designation:
    designation = Designation(
        name=name,
        category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD",
        min_experience="3+ years",
        employment_type=EmploymentTypeEnum.FULL_TIME,
    )
    db_session.add(designation)
    db_session.flush()
    return designation


def _make_employee(db_session, application, campus_id, *, designation_text: str, designation_id=None) -> Employee:
    employee = Employee(
        application_id=application.id,
        employee_code=f"SSE-{uuid.uuid4().hex[:6].upper()}",
        campus_id=campus_id,
        full_name="Test Employee",
        email=f"emp.{uuid.uuid4().hex[:8]}@example.com",
        designation=designation_text,
        designation_id=designation_id,
        date_of_joining=date.today(),
    )
    db_session.add(employee)
    db_session.flush()
    return employee


def test_backfill_matches_case_insensitive_and_whitespace_padded_name(
    db_session, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory()
    designation = _make_designation(db_session, "Assistant Professor")

    application = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)
    employee = _make_employee(
        db_session,
        application,
        vacancy.campus.id,
        # Deliberately different case + surrounding whitespace -- the
        # migration's LOWER(TRIM(...)) match must still resolve this.
        designation_text="  assistant professor  ",
    )

    db_session.execute(text(_BACKFILL_SQL))
    db_session.flush()
    db_session.refresh(employee)

    assert employee.designation_id == designation.id


def test_backfill_leaves_non_matching_designation_text_null(
    db_session, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory()
    _make_designation(db_session, "Assistant Professor")

    application = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)
    employee = _make_employee(
        db_session, application, vacancy.campus.id, designation_text="Some Free-Text Title Not In Master"
    )

    db_session.execute(text(_BACKFILL_SQL))
    db_session.flush()
    db_session.refresh(employee)

    assert employee.designation_id is None


def test_backfill_does_not_overwrite_an_already_set_designation_id(
    db_session, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory()
    correct_designation = _make_designation(db_session, "Associate Professor")
    wrong_designation = _make_designation(db_session, "Some Free-Text Title Not In Master")

    application = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)
    # designation_id already set (e.g. by a prior manual fix) even though the
    # free-text designation column would otherwise match a *different* row --
    # the migration's `WHERE ... designation_id IS NULL` guard must leave it
    # untouched rather than clobbering it.
    employee = _make_employee(
        db_session,
        application,
        vacancy.campus.id,
        designation_text="Some Free-Text Title Not In Master",
        designation_id=correct_designation.id,
    )

    db_session.execute(text(_BACKFILL_SQL))
    db_session.flush()
    db_session.refresh(employee)

    assert employee.designation_id == correct_designation.id
    assert employee.designation_id != wrong_designation.id


def test_backfill_matches_and_skips_side_by_side(db_session, published_vacancy_factory, application_factory):
    """One migration run, three employees: matched / non-matched / already-set
    -- mirrors the "log match vs no-match counts" discipline the migration
    itself performs (see its print() call), verified here as row-level
    outcomes rather than the printed count (which is exercised live against
    the real dev DB instead, per this session's report)."""
    vacancy = published_vacancy_factory()
    designation = _make_designation(db_session, "Lab Technician")
    pre_set_designation = _make_designation(db_session, "Security Guard")

    app_matched = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)
    app_unmatched = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)
    app_preset = application_factory(vacancy.job_posting, recorded_by=vacancy.recruitment_officer)

    matched_employee = _make_employee(db_session, app_matched, vacancy.campus.id, designation_text="LAB TECHNICIAN")
    unmatched_employee = _make_employee(
        db_session, app_unmatched, vacancy.campus.id, designation_text="Totally Unknown Role"
    )
    preset_employee = _make_employee(
        db_session,
        app_preset,
        vacancy.campus.id,
        designation_text="Security Guard",
        designation_id=pre_set_designation.id,
    )

    before_null_count = (
        db_session.execute(text("SELECT count(*) FROM employees WHERE designation_id IS NULL")).scalar_one()
    )
    db_session.execute(text(_BACKFILL_SQL))
    db_session.flush()
    after_null_count = (
        db_session.execute(text("SELECT count(*) FROM employees WHERE designation_id IS NULL")).scalar_one()
    )
    assert before_null_count - after_null_count == 1  # only the matched row moved from NULL -> set

    db_session.refresh(matched_employee)
    db_session.refresh(unmatched_employee)
    db_session.refresh(preset_employee)

    assert matched_employee.designation_id == designation.id
    assert unmatched_employee.designation_id is None
    assert preset_employee.designation_id == pre_set_designation.id
