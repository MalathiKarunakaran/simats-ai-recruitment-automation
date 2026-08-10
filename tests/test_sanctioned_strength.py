"""Sanctioned Strength (zany-snuggling-pie.md Phase A) -- data-model-only:
model create/read round-trips for the three new tables, plus the reusable
"current-effective row" resolution function
(app/services/sanctioned_strength.py) that every later phase (register
rewrite, availability strip, bulk upload) will reuse. No router endpoints
exist yet in this phase, so these are model/service-level tests using
`db_session` directly rather than API calls.
"""

from datetime import date, timedelta

from app.models.bulk_upload_log import BulkUploadLog
from app.models.designation import Designation
from app.models.enums import (
    BulkUploadStatusEnum,
    EmploymentTypeEnum,
    SanctionedStrengthChangeSourceEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory
from app.services.sanctioned_strength import current_effective_row, current_effective_rows


def _make_designation(db_session, name: str = "Assistant Professor") -> Designation:
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


def test_create_and_read_sanctioned_strength_round_trip(db_session, campus_factory, department_factory, user_factory):
    campus = campus_factory("SSE")
    department = department_factory("SSE", "Computer Science")
    designation = _make_designation(db_session)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    row = SanctionedStrength(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        category=StaffRoleCategoryEnum.TEACHING,
        approved_strength=10,
        effective_from=date.today(),
        remarks="Initial sanction",
        created_by_id=hr_admin.id,
    )
    db_session.add(row)
    db_session.flush()

    fetched = db_session.query(SanctionedStrength).filter(SanctionedStrength.id == row.id).one()
    assert fetched.approved_strength == 10
    assert fetched.is_active is True
    assert fetched.category == StaffRoleCategoryEnum.TEACHING
    assert fetched.created_by_id == hr_admin.id
    assert fetched.updated_by_id is None
    assert fetched.campus_id == campus.id
    assert fetched.department_id == department.id
    assert fetched.designation_id == designation.id


def test_approved_strength_negative_is_rejected_by_check_constraint(
    db_session, campus_factory, department_factory, user_factory
):
    import pytest
    from sqlalchemy.exc import IntegrityError

    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Lab Technician")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    row = SanctionedStrength(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        category=StaffRoleCategoryEnum.NON_TEACHING,
        approved_strength=-1,
        effective_from=date.today(),
        created_by_id=hr_admin.id,
    )
    db_session.add(row)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_sanctioned_strength_history_round_trip(db_session, campus_factory, department_factory, user_factory):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Associate Professor")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    row = SanctionedStrength(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        category=StaffRoleCategoryEnum.TEACHING,
        approved_strength=5,
        effective_from=date.today(),
        created_by_id=hr_admin.id,
    )
    db_session.add(row)
    db_session.flush()

    # The initial-insert history row has no old_value.
    history = SanctionedStrengthHistory(
        sanctioned_strength_id=row.id,
        old_value=None,
        new_value=5,
        changed_by_id=hr_admin.id,
        source=SanctionedStrengthChangeSourceEnum.MANUAL,
    )
    db_session.add(history)
    db_session.flush()

    fetched = db_session.query(SanctionedStrengthHistory).filter(SanctionedStrengthHistory.id == history.id).one()
    assert fetched.old_value is None
    assert fetched.new_value == 5
    assert fetched.source == SanctionedStrengthChangeSourceEnum.MANUAL
    assert fetched.bulk_upload_log_id is None
    assert fetched.sanctioned_strength_id == row.id


def test_bulk_upload_log_round_trip(db_session, user_factory):
    from datetime import datetime, timezone

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    uploaded_at = datetime.now(timezone.utc)

    log = BulkUploadLog(
        filename="sanctioned_strength.xlsx",
        uploaded_by_id=hr_admin.id,
        rows_total=10,
        rows_created=6,
        rows_updated=3,
        rows_rejected=1,
        status=BulkUploadStatusEnum.COMPLETED,
        undo_deadline=uploaded_at + timedelta(hours=24),
    )
    db_session.add(log)
    db_session.flush()

    fetched = db_session.query(BulkUploadLog).filter(BulkUploadLog.id == log.id).one()
    assert fetched.filename == "sanctioned_strength.xlsx"
    assert fetched.rows_total == 10
    assert fetched.rows_created == 6
    assert fetched.rows_updated == 3
    assert fetched.rows_rejected == 1
    assert fetched.status == BulkUploadStatusEnum.COMPLETED
    assert fetched.undone_at is None
    assert fetched.undone_by_id is None
    assert fetched.stored_file_object_key is None


def test_sanctioned_strength_history_linked_to_bulk_upload_log(db_session, campus_factory, department_factory, user_factory):
    from datetime import datetime, timezone

    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Lab Assistant")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    row = SanctionedStrength(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        category=StaffRoleCategoryEnum.NON_TEACHING,
        approved_strength=2,
        effective_from=date.today(),
        created_by_id=hr_admin.id,
    )
    db_session.add(row)
    db_session.flush()

    uploaded_at = datetime.now(timezone.utc)
    upload_log = BulkUploadLog(
        filename="bulk.xlsx",
        uploaded_by_id=hr_admin.id,
        rows_total=1,
        rows_created=0,
        rows_updated=1,
        rows_rejected=0,
        undo_deadline=uploaded_at + timedelta(hours=24),
    )
    db_session.add(upload_log)
    db_session.flush()

    history = SanctionedStrengthHistory(
        sanctioned_strength_id=row.id,
        old_value=1,
        new_value=2,
        changed_by_id=hr_admin.id,
        source=SanctionedStrengthChangeSourceEnum.BULK_UPLOAD,
        bulk_upload_log_id=upload_log.id,
    )
    db_session.add(history)
    db_session.flush()

    fetched = db_session.query(SanctionedStrengthHistory).filter(SanctionedStrengthHistory.id == history.id).one()
    assert fetched.bulk_upload_log_id == upload_log.id
    assert fetched.source == SanctionedStrengthChangeSourceEnum.BULK_UPLOAD


# --- current_effective_rows / current_effective_row -------------------------------------------------


def _seed_history_of_sanctions(db_session, campus, department, designation, hr_admin, entries):
    """entries: list of (effective_from, approved_strength, is_active) tuples."""
    rows = []
    for effective_from, approved_strength, is_active in entries:
        row = SanctionedStrength(
            campus_id=campus.id,
            department_id=department.id,
            designation_id=designation.id,
            category=StaffRoleCategoryEnum.TEACHING,
            approved_strength=approved_strength,
            effective_from=effective_from,
            is_active=is_active,
            created_by_id=hr_admin.id,
        )
        db_session.add(row)
        rows.append(row)
    db_session.flush()
    return rows


def test_current_effective_row_picks_latest_effective_from_leq_today(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Professor")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    today = date.today()

    _seed_history_of_sanctions(
        db_session,
        campus,
        department,
        designation,
        hr_admin,
        [
            (today - timedelta(days=60), 5, True),
            (today - timedelta(days=30), 8, True),
            (today - timedelta(days=10), 10, True),
        ],
    )

    current = current_effective_row(
        db_session, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert current is not None
    assert current.approved_strength == 10
    assert current.effective_from == today - timedelta(days=10)


def test_current_effective_row_ignores_future_dated_rows(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Reader")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    today = date.today()

    _seed_history_of_sanctions(
        db_session,
        campus,
        department,
        designation,
        hr_admin,
        [
            (today - timedelta(days=10), 10, True),
            # Future-dated -- a higher value that should NOT be picked yet.
            (today + timedelta(days=30), 99, True),
        ],
    )

    current = current_effective_row(
        db_session, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert current is not None
    assert current.approved_strength == 10


def test_current_effective_row_ignores_inactive_rows(db_session, campus_factory, department_factory, user_factory):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Instructor")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    today = date.today()

    _seed_history_of_sanctions(
        db_session,
        campus,
        department,
        designation,
        hr_admin,
        [
            (today - timedelta(days=20), 6, True),
            # Later effective_from but inactive -- must not win over the
            # earlier active row.
            (today - timedelta(days=5), 20, False),
        ],
    )

    current = current_effective_row(
        db_session, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert current is not None
    assert current.approved_strength == 6


def test_current_effective_row_returns_none_when_never_sanctioned(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Never Sanctioned Role")

    current = current_effective_row(
        db_session, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert current is None


def test_current_effective_rows_department_wide_returns_one_row_per_designation(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation_a = _make_designation(db_session, "Designation A")
    designation_b = _make_designation(db_session, "Designation B")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    today = date.today()

    _seed_history_of_sanctions(
        db_session, campus, department, designation_a, hr_admin,
        [(today - timedelta(days=30), 4, True), (today - timedelta(days=5), 7, True)],
    )
    _seed_history_of_sanctions(
        db_session, campus, department, designation_b, hr_admin,
        [(today - timedelta(days=15), 3, True)],
    )

    rows = current_effective_rows(db_session, department_id=department.id)
    by_designation = {row.designation_id: row.approved_strength for row in rows}
    assert by_designation == {designation_a.id: 7, designation_b.id: 3}


def test_current_effective_rows_as_of_resolves_a_past_date(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = _make_designation(db_session, "Historical Role")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    today = date.today()

    _seed_history_of_sanctions(
        db_session,
        campus,
        department,
        designation,
        hr_admin,
        [
            (today - timedelta(days=60), 5, True),
            (today - timedelta(days=10), 10, True),
        ],
    )

    # As of 30 days ago, only the 60-days-ago row was effective yet.
    historical = current_effective_row(
        db_session,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        as_of=today - timedelta(days=30),
    )
    assert historical is not None
    assert historical.approved_strength == 5
