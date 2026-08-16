"""Tests for the Sanctioned Strength Housekeeping operational view
(glowing-zooming-hamming.md Phase G) -- GET /api/v1/sanctioned-strength/
views/housekeeping (app/api/v1/routers/sanctioned_strength.py), backed by
app/services/sanctioned_strength_views.py::list_housekeeping_strength_rows.

`strength_row_status`'s one-test-per-state coverage and the generic sort/
filter/pagination mechanics are already covered by
tests/test_sanctioned_strength_views.py's Teaching tests -- this file
focuses on what's genuinely new for this view's own (Location, not
department/designation) grain, mirroring every judgment call documented in
app/services/sanctioned_strength_views.py's module docstring's "Phase G"
section:
- judgment call #1: Required sums across >1 HOUSEKEEPING designation
  sanctioned at the same Location; Available counts the roster across every
  designation there, not designation-scoped; one Location = one row.
- judgment call #2: the floor-at-zero vs signed-status split -- Available >
  Required drives OVERSTAFFED via `strength_row_status` even though the
  row's own `vacancy` field reads 0, not negative.
- judgment call #3: is_inactive from Location.is_active; has_pending_request
  batched across every (campus, department, designation) key contributing
  to the location.
- judgment call #4: `shifts` derivation (distinct, sorted, roster-based;
  [] for zero roster).
- judgment call #5: no department/designation/sanctioned_strength_id field
  ever appears on this row.
- the usual filters/sort/pagination/status_counts/campus-scope-isolation
  coverage this module's existing tests already establish a pattern for.
"""

import uuid

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.vacancy_request import VacancyRequest
from app.services import vacancy_workflow

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/sanctioned-strength/views/housekeeping"


def _list(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def _hk_department(department_factory, campus_code: str, name: str | None = None):
    return department_factory(
        campus_code, name=name or f"HK Dept {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.HOUSEKEEPING
    )


def _make_vr(db_session, campus, department, designation, hod, requested_count: int = 1):
    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        role_category=StaffRoleCategoryEnum.HOUSEKEEPING,
        position_title=f"Role-{uuid.uuid4().hex[:6]}",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=requested_count,
        qualification="N/A",
        experience_required="N/A",
        requested_by_id=hod.id,
    )
    db_session.add(vr)
    db_session.flush()
    return vr


# --- judgment call #1: aggregate grain (SUM required / COUNT available) ---


def test_required_sums_across_two_designations_at_same_location(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    supervisor_desig = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="HK Supervisor", department=department)
    cleaner_desig = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="Cleaner", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    sanctioned_strength_factory(
        campus=campus, department=department, designation=supervisor_desig, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=cleaner_desig, approved_strength=3,
        created_by=hr_admin, location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=cleaner_desig, location=location, created_by=hr_admin)

    response = _list(client, hr_admin, location_id=str(location.id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    row = body["items"][0]
    assert row["location_id"] == str(location.id)
    assert row["required"] == 4  # 1 + 3, not two separate rows
    assert row["available"] == 1
    assert row["vacancy"] == 3


def test_available_counts_across_designations_not_designation_scoped(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    desig_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="Desig A", department=department)
    desig_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="Desig B", department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    sanctioned_strength_factory(
        campus=campus, department=department, designation=desig_a, approved_strength=5,
        created_by=hr_admin, location_id=location.id,
    )
    # Staff hired under desig_b (not desig_a) still counts toward this
    # location's Available -- COUNT is location-scoped, never
    # designation-scoped.
    housekeeping_staff_factory(campus=campus, designation=desig_b, location=location, created_by=hr_admin)
    housekeeping_staff_factory(campus=campus, designation=desig_b, location=location, created_by=hr_admin)

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["available"] == 2


# --- judgment call #2: floor-at-zero vacancy vs signed status ---


def test_overstaffed_status_but_vacancy_field_floored_at_zero(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["required"] == 1
    assert row["available"] == 2
    assert row["status"] == "OVERSTAFFED"
    assert row["vacancy"] == 0  # floored, not -1


def test_vacancy_recruitment_required_when_understaffed(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2,
        created_by=hr_admin, location_id=location.id,
    )

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["vacancy"] == 2
    assert row["status"] == "VACANCY_RECRUITMENT_REQUIRED"


# --- judgment call #3: is_inactive / has_pending_request ---


def test_inactive_location_status(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
    db_session,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )
    location.is_active = False
    db_session.flush()

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["status"] == "INACTIVE"


def test_pending_request_from_any_contributing_key_marks_approval_pending(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
    db_session,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    desig_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="Desig A", department=department)
    desig_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="Desig B", department=department)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    sanctioned_strength_factory(
        campus=campus, department=department, designation=desig_a, approved_strength=2,
        created_by=hr_admin, location_id=location.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=desig_b, approved_strength=2,
        created_by=hr_admin, location_id=location.id,
    )

    # An in-flight request against desig_b only -- must still mark the whole
    # location's aggregate row APPROVAL_PENDING.
    vr = _make_vr(db_session, campus, department, desig_b, hod, requested_count=1)
    vacancy_workflow.submit(db_session, vr, hod, None)

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["status"] == "APPROVAL_PENDING"


# --- judgment call #4: shifts derivation ---


def test_shifts_distinct_sorted_from_active_roster(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2,
        created_by=hr_admin, location_id=location.id,
    )
    housekeeping_staff_factory(
        campus=campus, designation=designation, location=location, created_by=hr_admin, shift="MORNING"
    )
    housekeeping_staff_factory(
        campus=campus, designation=designation, location=location, created_by=hr_admin, shift="EVENING"
    )
    # An inactive roster entry must not contribute a shift.
    housekeeping_staff_factory(
        campus=campus, designation=designation, location=location, created_by=hr_admin, shift="NIGHT",
        is_active=False,
    )

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["shifts"] == ["EVENING", "MORNING"]


def test_shifts_empty_when_zero_roster(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=2,
        created_by=hr_admin, location_id=location.id,
    )

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    assert row["shifts"] == []
    assert row["available"] == 0


# --- judgment call #5: no department/designation columns ever ---


def test_row_never_exposes_department_or_designation_fields(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )

    response = _list(client, hr_admin, location_id=str(location.id))
    row = response.json()["items"][0]
    for forbidden_key in ("department_id", "department_name", "designation_id", "designation_name", "sanctioned_strength_id"):
        assert forbidden_key not in row


# --- Teaching/Non-Teaching never leak into this view ---


def test_teaching_designation_never_appears(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    user_factory,
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

    response = _list(client, hr_admin)
    assert response.status_code == 200, response.text
    # No location_id was ever set on this TEACHING row, so it can never
    # surface in the Housekeeping view regardless of campus filter.
    assert all(item["location_name"] != department.name for item in response.json()["items"])


# --- filters ---


def test_block_filter_ilike(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
    db_session,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location_a = location_factory("SPIER", name=f"Loc-A-{uuid.uuid4().hex[:6]}")
    location_a.block_building = "North Block"
    location_b = location_factory("SPIER", name=f"Loc-B-{uuid.uuid4().hex[:6]}")
    location_b.block_building = "South Wing"
    db_session.flush()
    # Two distinct designations -- SanctionedStrength's own uniqueness key is
    # (campus, department, designation, effective_from), not location_id, so
    # two rows at two different locations can't share one designation on the
    # same effective_from.
    designation_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_a, approved_strength=1,
        created_by=hr_admin, location_id=location_a.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_b, approved_strength=1,
        created_by=hr_admin, location_id=location_b.id,
    )

    response = _list(client, hr_admin, block="north")
    names = {r["location_name"] for r in response.json()["items"]}
    assert location_a.name in names
    assert location_b.name not in names


def test_shift_filter(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location_a = location_factory("SPIER", name=f"Loc-A-{uuid.uuid4().hex[:6]}")
    location_b = location_factory("SPIER", name=f"Loc-B-{uuid.uuid4().hex[:6]}")
    designation_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_a, approved_strength=1,
        created_by=hr_admin, location_id=location_a.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_b, approved_strength=1,
        created_by=hr_admin, location_id=location_b.id,
    )
    housekeeping_staff_factory(
        campus=campus, designation=designation_a, location=location_a, created_by=hr_admin, shift="NIGHT"
    )
    housekeeping_staff_factory(
        campus=campus, designation=designation_b, location=location_b, created_by=hr_admin, shift="MORNING"
    )

    response = _list(client, hr_admin, shift="NIGHT")
    names = {r["location_name"] for r in response.json()["items"]}
    assert location_a.name in names
    assert location_b.name not in names


def test_search_matches_location_name(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    unique = uuid.uuid4().hex[:8]
    location = location_factory("SPIER", name=f"Searchable-{unique}")
    other_location = location_factory("SPIER", name=f"Other-{uuid.uuid4().hex[:8]}")
    designation_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_a, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_b, approved_strength=1,
        created_by=hr_admin, location_id=other_location.id,
    )

    response = _list(client, hr_admin, search=f"searchable-{unique}")
    names = {r["location_name"] for r in response.json()["items"]}
    assert location.name in names
    assert other_location.name not in names


def test_vacancy_filter_matches_floored_field(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location = location_factory("SPIER", name=f"Block-{uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=1,
        created_by=hr_admin, location_id=location.id,
    )
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)
    housekeeping_staff_factory(campus=campus, designation=designation, location=location, created_by=hr_admin)

    # Overstaffed -- raw vacancy is -1, but the floored field is 0, and the
    # `vacancy` filter param matches against that floored field.
    response = _list(client, hr_admin, vacancy=0, location_id=str(location.id))
    assert response.json()["total"] == 1
    response_negative = _list(client, hr_admin, vacancy=-1, location_id=str(location.id))
    assert response_negative.json()["total"] == 0


# --- status_counts / sort / pagination ---


def test_status_counts_present_and_correctly_shaped(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location_vacant = location_factory("SPIER", name=f"Vacant-{uuid.uuid4().hex[:6]}")
    location_full = location_factory("SPIER", name=f"Full-{uuid.uuid4().hex[:6]}")
    designation_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_a, approved_strength=1,
        created_by=hr_admin, location_id=location_vacant.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_b, approved_strength=0,
        created_by=hr_admin, location_id=location_full.id,
    )

    body = _list(client, hr_admin, campus_code="SPIER").json()
    assert body["status_counts"]["VACANCY_RECRUITMENT_REQUIRED"] >= 1
    assert body["status_counts"]["FULLY_STAFFED"] >= 1
    assert body["status_counts"]["ALL"] == body["status_counts"]["VACANCY_RECRUITMENT_REQUIRED"] + body["status_counts"]["FULLY_STAFFED"]


def test_sort_by_required_desc(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus = campus_factory("SPIER")
    department = _hk_department(department_factory, "SPIER")
    location_low = location_factory("SPIER", name=f"Low-{uuid.uuid4().hex[:6]}")
    location_high = location_factory("SPIER", name=f"High-{uuid.uuid4().hex[:6]}")
    designation_a = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    designation_b = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_a, approved_strength=1,
        created_by=hr_admin, location_id=location_low.id,
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation_b, approved_strength=9,
        created_by=hr_admin, location_id=location_high.id,
    )

    response = _list(client, hr_admin, campus_code="SPIER", sort_by="required", sort_dir="desc")
    items = response.json()["items"]
    required_values = [item["required"] for item in items if item["location_name"] in (location_low.name, location_high.name)]
    idx_high = next(i for i, item in enumerate(items) if item["location_name"] == location_high.name)
    idx_low = next(i for i, item in enumerate(items) if item["location_name"] == location_low.name)
    assert idx_high < idx_low


# --- campus scope isolation ---


def test_single_campus_role_never_sees_other_campus_rows(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    user_factory,
):
    campus_sse = campus_factory("SSE")
    campus_scad = campus_factory("SCAD")
    dept_sse = _hk_department(department_factory, "SSE", name=f"SSE HK Dept {uuid.uuid4().hex[:6]}")
    dept_scad = _hk_department(department_factory, "SCAD", name=f"SCAD HK Dept {uuid.uuid4().hex[:6]}")
    location_sse = location_factory("SSE", name=f"SSE Loc {uuid.uuid4().hex[:6]}")
    location_scad = location_factory("SCAD", name=f"SCAD Loc {uuid.uuid4().hex[:6]}")
    designation_sse = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="SSE HK Role", department=dept_sse)
    designation_scad = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, name="SCAD HK Role", department=dept_scad)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus_sse, department=dept_sse, designation=designation_sse, approved_strength=1,
        created_by=hr_admin, location_id=location_sse.id,
    )
    sanctioned_strength_factory(
        campus=campus_scad, department=dept_scad, designation=designation_scad, approved_strength=1,
        created_by=hr_admin, location_id=location_scad.id,
    )

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _list(client, hod_sse, campus_code="SCAD")
    names = {r["location_name"] for r in response.json()["items"]}
    assert location_sse.name in names
    assert location_scad.name not in names


# --- RBAC / validation ---


def test_candidate_forbidden(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = _list(client, candidate)
    assert response.status_code == 403


def test_invalid_sort_by_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_by="department_name")
    assert response.status_code == 422


def test_invalid_sort_dir_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_dir="sideways")
    assert response.status_code == 422


def test_invalid_status_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, status="BOGUS")
    assert response.status_code == 422


def test_invalid_shift_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, shift="NOT_A_SHIFT")
    assert response.status_code == 422
