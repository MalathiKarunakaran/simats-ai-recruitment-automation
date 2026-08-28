"""Phase D (glowing-zooming-hamming.md) -- verifies the HOUSEKEEPING branch
added to `app/services/sanctioned_strength.py`'s `working_count_for()` /
`list_department_designation_breakdown()` actually propagates into every
real caller, not just the two function definitions themselves.

Confirmed callers audited (see this module's docstrings + the branch's own
docstrings for the "why"):
- `app/services/sanctioned_strength.py` itself: `compute_availability_to_request`
  (feeds both `GET /sanctioned-strength/availability` and
  `vacancy_workflow.py::submit()`'s sanction enforcement) and
  `list_department_designation_breakdown`.
- `app/api/v1/routers/sanctioned_strength.py`'s `delete_sanctioned_strength`
  soft-delete guard.
- `app/services/reporting.py`'s `sanctioned_strength_reconciliation_report`
  (exercised end-to-end below via `GET /reports/sanctioned-strength-reconciliation`).
- `app/api/v1/routers/vacancy_register.py`'s
  `get_department_sanctioned_strength_breakdown` (exercised end-to-end below
  via `GET /departments/{id}/sanctioned-strength-breakdown`).
- `app/api/v1/routers/departments.py` and `app/api/v1/routers/locations.py`
  were both grepped and confirmed to NOT call either function directly (only
  a code comment in departments.py references working_count_for by name) --
  nothing to change or test there.

Each HTTP-level test below is written so it would FAIL before the Phase D
branch existed (working_count_for would have queried the always-empty
Employee table for a HOUSEKEEPING designation and returned 0, hiding a real
over-commitment / making a real live headcount invisible) and PASSES after.
"""

import uuid
from datetime import date

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.services.sanctioned_strength import list_department_designation_breakdown, working_count_for

from tests.conftest import auth_headers

RECONCILIATION_ENDPOINT = "/api/v1/reports/sanctioned-strength-reconciliation"


def _housekeeping_setup(
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Housekeeping Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.HOUSEKEEPING]
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    location = location_factory("SSE", name=f"HK Block {uuid.uuid4().hex[:6]}")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    return campus, department, designation, location, hr_admin


# --- Service-level: working_count_for -----------------------------------


def test_working_count_for_housekeeping_counts_housekeeping_staff_not_employee(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    housekeeping_staff_factory,
    db_session,
):
    campus, department, designation, location, hr_admin = _housekeeping_setup(
        campus_factory, department_factory, designation_factory, location_factory, user_factory
    )
    # Two active + one inactive HousekeepingStaff at this (designation, location).
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    housekeeping_staff_factory(
        campus=campus, designation=designation, location=location, created_by=hr_admin, is_active=False
    )
    db_session.commit()

    working = working_count_for(
        db_session,
        department_id=department.id,
        designation_id=designation.id,
        category=StaffRoleCategoryEnum.HOUSEKEEPING,
        location_id=location.id,
    )
    assert working == 2


def test_working_count_for_without_category_still_counts_employee_unchanged(
    client, published_vacancy_factory, hired_employee_factory, designation_factory, db_session
):
    # Regression guard: Teaching/Non-Teaching callers (category left unset)
    # keep the pre-Phase-D Employee-based behavior exactly as before.
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    designation = designation_factory(department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()
    db_session.commit()

    working = working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id)
    assert working == 1


# --- Service-level: list_department_designation_breakdown ----------------


def test_breakdown_housekeeping_designation_counts_housekeeping_staff(
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    sanctioned_strength_factory,
    housekeeping_staff_factory,
    db_session,
):
    campus, department, designation, location, hr_admin = _housekeeping_setup(
        campus_factory, department_factory, designation_factory, location_factory, user_factory
    )
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=3,
        created_by=hr_admin,
        location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    db_session.commit()

    rows = list_department_designation_breakdown(db_session, department.id)
    matching = [r for r in rows if r["designation_id"] == designation.id]
    assert len(matching) == 1
    row = matching[0]
    assert row["approved"] == 3
    assert row["working"] == 1
    assert row["vacancy"] == 2
    assert row["location_id"] == location.id


# --- HTTP: reporting.py's reconciliation report ---------------------------


def test_reconciliation_report_flags_over_committed_housekeeping_designation(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    sanctioned_strength_factory,
    housekeeping_staff_factory,
    db_session,
):
    """Before the Phase D branch, working_count_for always queried Employee
    for this key and got 0 back (no Employee row exists for Housekeeping
    staff), so this over-committed HOUSEKEEPING row would never have been
    flagged by the reconciliation report at all -- this test fails on the
    pre-Phase-D code and passes after.
    """
    campus, department, designation, location, hr_admin = _housekeeping_setup(
        campus_factory, department_factory, designation_factory, location_factory, user_factory
    )
    # approved_strength=0 (deliberately under-sanctioned) + 1 live active
    # HousekeepingStaff at this (designation, location) => working(1) >
    # approved(0), a genuine over-commitment the reconciliation report
    # should surface.
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=0,
        created_by=hr_admin,
        location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    db_session.commit()

    response = client.get(RECONCILIATION_ENDPOINT, headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    matching = [
        r for r in rows if r["department_name"] == department.name and r["designation_name"] == designation.name
    ]
    assert len(matching) == 1
    row = matching[0]
    assert row["category"] == "HOUSEKEEPING"
    assert row["approved_strength"] == 0
    assert row["working_count"] == 1
    assert row["already_requested"] == 0
    assert row["over_by"] == 1


def test_reconciliation_report_not_flagged_when_housekeeping_staff_inactive(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    sanctioned_strength_factory,
    housekeeping_staff_factory,
    db_session,
):
    campus, department, designation, location, hr_admin = _housekeeping_setup(
        campus_factory, department_factory, designation_factory, location_factory, user_factory
    )
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=0,
        created_by=hr_admin,
        location_id=location.id,
    )
    # Only an inactive (soft-deleted) HousekeepingStaff row -- must not count
    # toward working_count, so this key should not be flagged.
    housekeeping_staff_factory(
        campus=campus, designation=designation, location=location, created_by=hr_admin, is_active=False
    )
    db_session.commit()

    response = client.get(RECONCILIATION_ENDPOINT, headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    matching = [
        r for r in rows if r["department_name"] == department.name and r["designation_name"] == designation.name
    ]
    assert matching == []


# --- HTTP: vacancy_register.py's designation breakdown endpoint ----------


def test_vacancy_register_breakdown_endpoint_shows_live_housekeeping_working_count(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    sanctioned_strength_factory,
    housekeeping_staff_factory,
    db_session,
):
    """Before the Phase D branch, the breakdown endpoint's `working` field
    for a HOUSEKEEPING designation would always read 0 (always-empty
    Employee query), no matter how many HousekeepingStaff rows existed --
    this test fails on the pre-Phase-D code and passes after.
    """
    campus, department, designation, location, hr_admin = _housekeeping_setup(
        campus_factory, department_factory, designation_factory, location_factory, user_factory
    )
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=4,
        created_by=hr_admin,
        location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    db_session.commit()

    response = client.get(
        f"/api/v1/departments/{department.id}/sanctioned-strength-breakdown",
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    matching = [item for item in items if item["designation_id"] == str(designation.id)]
    assert len(matching) == 1
    row = matching[0]
    assert row["approved"] == 4
    assert row["working"] == 2
    assert row["vacancy"] == 2
    assert row["location_id"] == str(location.id)
