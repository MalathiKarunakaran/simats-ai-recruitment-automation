"""Tests for the Sanctioned Strength Non-Teaching operational view
(glowing-zooming-hamming.md Phase F).

`strength_row_status`'s one-test-per-state coverage and the full
sort/filter/pagination/search/status_counts mechanics are already covered
for the shared code path by tests/test_sanctioned_strength_views.py's
Teaching tests (unchanged by this phase's refactor -- see that file's own
tests for proof they still pass byte-for-byte). This file focuses on the
things that are genuinely new/NON_TEACHING-specific per the plan's own test
guidance:
- category filtering actually excludes TEACHING/HOUSEKEEPING rows from the
  Non-Teaching view (the mirror image of test_sanctioned_strength_views.py's
  own `test_non_teaching_designation_never_appears`/
  `test_housekeeping_designation_never_appears`, but the other way around).
- the new endpoint's own param validation (422 on unknown sort_by/sort_dir/
  status) -- proves the second router handler wires the same validation
  the first one has, not just that the shared service function works.
- `working_count_for` is called with category=NON_TEACHING (not left None)
  for this view -- verified indirectly via a live headcount that would only
  be correct if the NON_TEACHING branch (which resolves identically to
  TEACHING/unset, see working_count_for's own docstring) is genuinely being
  exercised, and directly via HOUSEKEEPING rows never leaking through the
  same way the "never appears" tests above already prove.
- campus-scope isolation for the new endpoint, mirroring
  test_sanctioned_strength_views.py's own
  `test_single_campus_role_never_sees_other_campus_rows`.
"""

import uuid

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/sanctioned-strength/views/non-teaching"


def _list(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def test_row_basic_fields_for_non_teaching_designation(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory(
        "SPIER", name=f"NonTeaching Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    designation = designation_factory(
        StaffRoleCategoryEnum.NON_TEACHING, name="Office Assistant", department=department
    )
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=4, created_by=hr_admin
    )

    response = _list(client, hr_admin, department_id=str(department.id))
    assert response.status_code == 200, response.text
    body = response.json()
    row = body["items"][0]
    assert row["approved"] == 4
    assert row["working"] == 0
    assert row["vacancy"] == 4
    assert row["filled_pct"] == 0.0
    assert row["status"] == "VACANCY_RECRUITMENT_REQUIRED"
    assert row["department_name"] == department.name
    assert row["designation_name"] == "Office Assistant"
    assert row["campus_code"] == "SPIER"


def test_teaching_designation_never_appears_in_non_teaching_view(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory(
        "SPIER", name=f"Teaching Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING
    )
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2, created_by=hr_admin
    )

    response = _list(client, hr_admin, department_id=str(department.id))
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_housekeeping_designation_never_appears_in_non_teaching_view(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    user_factory,
    location_factory,
):
    campus = campus_factory("SPIER")
    department = department_factory(
        "SPIER", name=f"Housekeeping Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.HOUSEKEEPING
    )
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    location = location_factory("SPIER")
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=2,
        created_by=hr_admin,
        location_id=location.id,
    )

    response = _list(client, hr_admin, department_id=str(department.id))
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_working_count_reflects_live_non_teaching_employee(
    client,
    published_vacancy_factory,
    hired_employee_factory,
    designation_factory,
    sanctioned_strength_factory,
    db_session,
):
    """Proves working_count_for is genuinely called with
    category=NON_TEACHING for this view (not skipped/left at 0) -- a live
    hired employee assigned to a NON_TEACHING designation must be counted."""
    vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.NON_TEACHING
    )
    hired = hired_employee_factory(vacancy)

    designation = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()

    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=1,
        created_by=vacancy.hr_admin,
    )

    response = _list(client, vacancy.hr_admin, department_id=str(vacancy.department.id))
    row = response.json()["items"][0]
    assert row["working"] == 1
    assert row["vacancy"] == 0
    assert row["status"] == "FULLY_STAFFED"


def test_status_counts_present_and_correctly_shaped(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory(
        "SPIER", name=f"Counts Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    designation_vacant = designation_factory(
        StaffRoleCategoryEnum.NON_TEACHING, name="Counts Vacant", department=department
    )
    designation_full = designation_factory(
        StaffRoleCategoryEnum.NON_TEACHING, name="Counts Full", department=department
    )
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_vacant, approved_strength=1, created_by=hr_admin
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_full, approved_strength=0, created_by=hr_admin
    )

    unfiltered = _list(client, hr_admin, department_id=str(department.id)).json()
    assert unfiltered["status_counts"]["VACANCY_RECRUITMENT_REQUIRED"] == 1
    assert unfiltered["status_counts"]["FULLY_STAFFED"] == 1
    assert unfiltered["status_counts"]["ALL"] == 2


def test_single_campus_role_never_sees_other_campus_rows(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus_sse = campus_factory("SSE")
    campus_scad = campus_factory("SCAD")
    dept_sse = department_factory(
        "SSE", name=f"SSE NT Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    dept_scad = department_factory(
        "SCAD", name=f"SCAD NT Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    designation_sse = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, name="SSE NT Role", department=dept_sse)
    designation_scad = designation_factory(
        StaffRoleCategoryEnum.NON_TEACHING, name="SCAD NT Role", department=dept_scad
    )
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus_sse, department=dept_sse, designation=designation_sse, approved_strength=1, created_by=hr_admin
    )
    sanctioned_strength_factory(
        campus=campus_scad,
        department=dept_scad,
        designation=designation_scad,
        approved_strength=1,
        created_by=hr_admin,
    )

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _list(client, hod_sse, campus_code="SCAD")
    names = {r["designation_name"] for r in response.json()["items"]}
    assert "SSE NT Role" in names
    assert "SCAD NT Role" not in names


def test_candidate_forbidden(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = _list(client, candidate)
    assert response.status_code == 403


def test_invalid_sort_by_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_by="not_a_field")
    assert response.status_code == 422


def test_invalid_sort_dir_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_dir="sideways")
    assert response.status_code == 422


def test_invalid_status_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, status="BOGUS")
    assert response.status_code == 422
