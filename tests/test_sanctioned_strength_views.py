"""Tests for the Sanctioned Strength Teaching operational view
(glowing-zooming-hamming.md Phase E):
- app/services/sanctioned_strength_views.py's `strength_row_status` pure
  function (one test per state + the documented priority order) -- renamed
  from `teaching_strength_status` in Phase F when the function was reused,
  unchanged, for the Non-Teaching view too (see that module's docstring).
- GET /api/v1/sanctioned-strength/views/teaching (app/api/v1/routers/
  sanctioned_strength.py), mirroring tests/test_vacancy_register.py's own
  conventions for its sibling GET /departments/vacancy-register endpoint.

See tests/test_non_teaching_strength_views.py for the Phase F Non-Teaching
sibling coverage -- this file's own tests are otherwise left unchanged (see
that other file's own docstring for why).
"""

import uuid

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.vacancy_request import VacancyRequest
from app.services import vacancy_workflow
from app.services.sanctioned_strength_views import strength_row_status

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/sanctioned-strength/views/teaching"


def _list(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def _make_vr(
    db_session,
    campus,
    department,
    designation,
    hod,
    requested_count: int = 1,
):
    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title=f"Role-{uuid.uuid4().hex[:6]}",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=requested_count,
        qualification="PhD",
        experience_required="1 year",
        requested_by_id=hod.id,
    )
    db_session.add(vr)
    db_session.flush()
    return vr


# --- strength_row_status: one test per state + priority order ------------------


def test_status_vacancy_positive_is_vacancy_recruitment_required():
    assert (
        strength_row_status(vacancy=2, is_inactive=False, has_pending_request=False)
        == "VACANCY_RECRUITMENT_REQUIRED"
    )


def test_status_vacancy_zero_is_fully_staffed():
    assert strength_row_status(vacancy=0, is_inactive=False, has_pending_request=False) == "FULLY_STAFFED"


def test_status_vacancy_negative_is_overstaffed():
    assert strength_row_status(vacancy=-1, is_inactive=False, has_pending_request=False) == "OVERSTAFFED"


def test_status_pending_request_is_approval_pending():
    assert (
        strength_row_status(vacancy=1, is_inactive=False, has_pending_request=True) == "APPROVAL_PENDING"
    )
    # Also outranks the FULLY_STAFFED floor outcome.
    assert (
        strength_row_status(vacancy=0, is_inactive=False, has_pending_request=True) == "APPROVAL_PENDING"
    )


def test_status_inactive_outranks_everything():
    assert strength_row_status(vacancy=5, is_inactive=True, has_pending_request=True) == "INACTIVE"
    assert strength_row_status(vacancy=-5, is_inactive=True, has_pending_request=False) == "INACTIVE"


def test_status_priority_overstaffed_outranks_approval_pending():
    """The documented priority order: OVERSTAFFED is checked before
    APPROVAL_PENDING -- a key that is both overstaffed AND has an in-flight
    VacancyRequest must still read OVERSTAFFED."""
    assert (
        strength_row_status(vacancy=-1, is_inactive=False, has_pending_request=True) == "OVERSTAFFED"
    )


# --- GET /sanctioned-strength/views/teaching -----------------------------------------


def test_row_basic_fields_vacancy_recruitment_required(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Teaching Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Assistant Professor", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=3, created_by=hr_admin
    )

    response = _list(client, hr_admin, department_id=str(department.id))
    assert response.status_code == 200, response.text
    body = response.json()
    row = body["items"][0]
    assert row["approved"] == 3
    assert row["working"] == 0
    assert row["vacancy"] == 3
    assert row["filled_pct"] == 0.0
    assert row["status"] == "VACANCY_RECRUITMENT_REQUIRED"
    assert row["department_name"] == department.name
    assert row["designation_name"] == "Assistant Professor"
    assert row["campus_code"] == "SPIER"


def test_row_fully_staffed_when_working_matches_approved(
    client, published_vacancy_factory, hired_employee_factory, designation_factory, sanctioned_strength_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING)
    hired = hired_employee_factory(vacancy)

    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
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
    assert row["filled_pct"] == 100.0
    assert row["status"] == "FULLY_STAFFED"


def test_row_overstaffed_when_working_exceeds_approved(
    client, published_vacancy_factory, hired_employee_factory, designation_factory, sanctioned_strength_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2, role_category=StaffRoleCategoryEnum.TEACHING)
    hired_1 = hired_employee_factory(vacancy)
    hired_2 = hired_employee_factory(vacancy)

    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    hired_1.employee.designation_id = designation.id
    hired_2.employee.designation_id = designation.id
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
    assert row["working"] == 2
    assert row["vacancy"] == -1
    assert row["status"] == "OVERSTAFFED"


def test_row_approval_pending_when_in_flight_request_exists(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Pending Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2, created_by=hr_admin
    )

    vr = _make_vr(db_session, campus, department, designation, hod, requested_count=1)
    vacancy_workflow.submit(db_session, vr, hod, None)

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    # vacancy is still positive (2 approved, 0 working) but the pending
    # request outranks VACANCY_RECRUITMENT_REQUIRED.
    assert row["vacancy"] == 2
    assert row["status"] == "APPROVAL_PENDING"


def test_row_inactive_when_department_deactivated(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Deactivated Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1, created_by=hr_admin
    )
    department.is_active = False
    db_session.flush()

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    assert row["status"] == "INACTIVE"


def test_row_inactive_when_designation_deactivated(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Dept For Deact Desig {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1, created_by=hr_admin
    )
    designation.is_active = False
    db_session.flush()

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    assert row["status"] == "INACTIVE"


def test_row_priority_overstaffed_outranks_approval_pending_end_to_end(
    client,
    published_vacancy_factory,
    hired_employee_factory,
    designation_factory,
    sanctioned_strength_factory,
    user_factory,
    db_session,
):
    """API-level regression for the documented priority order: a designation
    that is simultaneously overstaffed AND has an in-flight VacancyRequest
    must read OVERSTAFFED, not APPROVAL_PENDING."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2, role_category=StaffRoleCategoryEnum.TEACHING)
    hired_1 = hired_employee_factory(vacancy)
    hired_2 = hired_employee_factory(vacancy)

    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    hired_1.employee.designation_id = designation.id
    hired_2.employee.designation_id = designation.id
    db_session.flush()

    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=1,
        created_by=vacancy.hr_admin,
    )

    # available_to_request = approved(1) - working(2) - already_requested(0)
    # = -1, which is < requested_count(1) -- submit() would normally 409
    # here, so use the SUPER_ADMIN override path to get a genuinely
    # in-flight request against an already-overstaffed designation.
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr = _make_vr(db_session, vacancy.campus, vacancy.department, designation, vacancy.hod, requested_count=1)
    vacancy_workflow.submit(
        db_session, vr, super_admin, None, override_sanction=True, override_justification="Emergency backfill"
    )

    response = _list(client, vacancy.hr_admin, department_id=str(vacancy.department.id))
    row = response.json()["items"][0]
    assert row["vacancy"] == -1
    assert row["status"] == "OVERSTAFFED"


def test_non_teaching_designation_never_appears(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory(
        "SPIER", name=f"NonTeaching Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    designation = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2, created_by=hr_admin
    )

    response = _list(client, hr_admin, department_id=str(department.id))
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_housekeeping_designation_never_appears(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, location_factory
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


def test_filters_department_designation_location(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, location_factory
):
    campus = campus_factory("SPIER")
    dept_a = department_factory("SPIER", name=f"Dept A {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_b = department_factory("SPIER", name=f"Dept B {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_a = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Professor A", department=dept_a)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Professor B", department=dept_b)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    location = location_factory("SPIER")
    sanctioned_strength_factory(
        campus=campus, department=dept_a, designation=designation_a, approved_strength=2, created_by=hr_admin, location_id=location.id
    )
    sanctioned_strength_factory(
        campus=campus, department=dept_b, designation=designation_b, approved_strength=3, created_by=hr_admin
    )

    by_department = _list(client, hr_admin, department_id=str(dept_a.id)).json()
    assert {r["designation_name"] for r in by_department["items"]} == {"Professor A"}

    by_designation = _list(client, hr_admin, designation_id=str(designation_b.id)).json()
    assert {r["designation_name"] for r in by_designation["items"]} == {"Professor B"}

    by_location = _list(client, hr_admin, location_id=str(location.id)).json()
    assert {r["designation_name"] for r in by_location["items"]} == {"Professor A"}


def test_vacancy_exact_filter(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Vac Filter Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_1 = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Lecturer 1", department=department)
    designation_2 = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Lecturer 2", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_1, approved_strength=2, created_by=hr_admin
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_2, approved_strength=5, created_by=hr_admin
    )

    response = _list(client, hr_admin, department_id=str(department.id), vacancy=2)
    names = {r["designation_name"] for r in response.json()["items"]}
    assert names == {"Lecturer 1"}


def test_status_filter(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Status Filter Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_vacant = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Vacant Role", department=department)
    designation_zero = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Zero Approved Role", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_vacant, approved_strength=3, created_by=hr_admin
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_zero, approved_strength=0, created_by=hr_admin
    )

    vacancy_required = _list(
        client, hr_admin, department_id=str(department.id), status="VACANCY_RECRUITMENT_REQUIRED"
    ).json()
    assert {r["designation_name"] for r in vacancy_required["items"]} == {"Vacant Role"}

    fully_staffed = _list(client, hr_admin, department_id=str(department.id), status="FULLY_STAFFED").json()
    assert {r["designation_name"] for r in fully_staffed["items"]} == {"Zero Approved Role"}


def test_status_counts_reflect_full_set_regardless_of_status_filter(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Counts Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_vacant = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Counts Vacant", department=department)
    designation_full = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Counts Full", department=department)
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

    filtered = _list(
        client, hr_admin, department_id=str(department.id), status="FULLY_STAFFED"
    ).json()
    assert filtered["total"] == 1
    # Narrowing via the status filter must not collapse the other statuses'
    # counts.
    assert filtered["status_counts"]["VACANCY_RECRUITMENT_REQUIRED"] == 1
    assert filtered["status_counts"]["ALL"] == 2


def test_search_filter_matches_department_or_designation_name(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name="Zoology", category=StaffRoleCategoryEnum.TEACHING)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Reader", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1, created_by=hr_admin
    )

    by_department_name = _list(client, hr_admin, search="Zoology").json()
    assert any(r["designation_name"] == "Reader" for r in by_department_name["items"])

    by_designation_name = _list(client, hr_admin, search="Reader").json()
    assert any(r["department_name"] == "Zoology" for r in by_designation_name["items"])

    no_match = _list(client, hr_admin, search="Nonexistent Xyz").json()
    assert no_match["items"] == []


def test_pagination_and_sort(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Sort Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    designation_a = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Alpha Role", department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Beta Role", department=department)
    designation_c = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Gamma Role", department=department)
    sanctioned_strength_factory(campus=campus, department=department, designation=designation_a, approved_strength=1, created_by=hr_admin)
    sanctioned_strength_factory(campus=campus, department=department, designation=designation_b, approved_strength=1, created_by=hr_admin)
    sanctioned_strength_factory(campus=campus, department=department, designation=designation_c, approved_strength=1, created_by=hr_admin)

    page1 = _list(
        client, hr_admin, department_id=str(department.id), limit=2, offset=0, sort_by="designation_name", sort_dir="asc"
    ).json()
    assert page1["total"] == 3
    assert [r["designation_name"] for r in page1["items"]] == ["Alpha Role", "Beta Role"]

    page2 = _list(
        client, hr_admin, department_id=str(department.id), limit=2, offset=2, sort_by="designation_name", sort_dir="asc"
    ).json()
    assert [r["designation_name"] for r in page2["items"]] == ["Gamma Role"]

    desc = _list(
        client, hr_admin, department_id=str(department.id), sort_by="designation_name", sort_dir="desc"
    ).json()
    assert [r["designation_name"] for r in desc["items"]] == ["Gamma Role", "Beta Role", "Alpha Role"]


def test_last_join_reflects_hired_employee(
    client, published_vacancy_factory, hired_employee_factory, designation_factory, sanctioned_strength_factory, db_session
):
    from datetime import date

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING)
    joining_date = date(2026, 1, 15)
    hired = hired_employee_factory(vacancy, joining_date=joining_date)

    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()

    sanctioned_strength_factory(
        campus=vacancy.campus, department=vacancy.department, designation=designation, approved_strength=1, created_by=vacancy.hr_admin
    )

    response = _list(client, vacancy.hr_admin, department_id=str(vacancy.department.id))
    row = response.json()["items"][0]
    assert row["last_join"] == "2026-01-15"


def test_single_campus_role_never_sees_other_campus_rows(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    """Same list-scoping convention as vacancy_register.py's own list
    endpoint (no single-resource enforce_campus_match 404 applies here --
    this is a collection endpoint): a single-campus-scoped caller's own
    campus_id filter is always applied regardless of any campus_code they
    pass, so cross-campus rows are silently excluded rather than 404ing."""
    campus_sse = campus_factory("SSE")
    campus_scad = campus_factory("SCAD")
    dept_sse = department_factory("SSE", name=f"SSE Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_scad = department_factory("SCAD", name=f"SCAD Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_sse = designation_factory(StaffRoleCategoryEnum.TEACHING, name="SSE Role", department=dept_sse)
    designation_scad = designation_factory(StaffRoleCategoryEnum.TEACHING, name="SCAD Role", department=dept_scad)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(campus=campus_sse, department=dept_sse, designation=designation_sse, approved_strength=1, created_by=hr_admin)
    sanctioned_strength_factory(campus=campus_scad, department=dept_scad, designation=designation_scad, approved_strength=1, created_by=hr_admin)

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _list(client, hod_sse, campus_code="SCAD")
    names = {r["designation_name"] for r in response.json()["items"]}
    assert "SSE Role" in names
    assert "SCAD Role" not in names


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
