"""Tests for Phase 4 of the permission-matrix epic: department-scope
enforcement via app.core.deps.DepartmentScope/get_department_scope/
enforce_department_match, wired into 5 routers whose resources carry a real
(or one-hop @property-derived) department_id: vacancy_requests.py,
employees.py, sanctioned_strength.py, job_postings.py, job_distribution.py.

Design (see the epic's own docs / app.core.deps.get_department_scope's
docstring for the full reasoning, not re-derived here):
- Empty `user_department_scope` rows for a user = fully unrestricted (opt-in
  narrowing only) -- the pre-existing, unrestricted behavior for every real
  user except the 2 CAMPUS_HOD rows that already exist.
- Applies to `DEPARTMENT_SCOPABLE_ROLES` (HR_ADMIN,
  ASSOCIATE_DEAN_RECRUITMENT, MANAGEMENT, RECRUITMENT_COORDINATOR).
  SUPER_ADMIN is always unrestricted; any role outside that set (e.g.
  CAMPUS_HOD) is always unrestricted by this mechanism regardless of whether
  it has user_department_scope rows.

  That used to read "GLOBAL_SCOPE_ROLES minus SUPER_ADMIN", computed inline
  in the dependency. It became its own set on 2026-09-01 when
  RECRUITMENT_COORDINATOR left GLOBAL_SCOPE_ROLES to become campus-scoped:
  under the old inline rule that single change would ALSO have stopped
  department narrowing applying to coordinators, silently. The last two tests
  in this file exist to catch exactly that.
- AND-combined with the pre-existing CampusScope, never a replacement.

Each router section below covers, at minimum: (a) an unrestricted
HR_ADMIN (no configured scope) sees/reaches everything -- a regression
check against pre-Phase-4 behavior; (b) the same role WITH a 1-department
scope only sees/reaches that department's resources, via both the list
filter and the single-resource 404; (c) SUPER_ADMIN is always unrestricted
regardless of any configured scope; (d) CAMPUS_HOD (outside
GLOBAL_SCOPE_ROLES) is unrestricted even with configured
user_department_scope rows, mirroring the real hod.sse@example.com/
hod.scad@example.com state today.
"""

import uuid

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers


def _make_vr(db_session, campus, department, hod, requested_count: int = 1) -> VacancyRequest:
    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
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


# =========================================================================
# 1. vacancy_requests.py
# =========================================================================


def test_vacancy_requests_unrestricted_hr_admin_sees_both_departments(
    client, db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"Dept A {uuid.uuid4().hex[:6]}")
    dept_b = department_factory("SSE", name=f"Dept B {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    vr_a = _make_vr(db_session, campus, dept_a, hod)
    vr_b = _make_vr(db_session, campus, dept_b, hod)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(vr_a.id) in ids
    assert str(vr_b.id) in ids

    get_b = client.get(f"/api/v1/vacancy-requests/{vr_b.id}", headers=auth_headers(client, hr_admin))
    assert get_b.status_code == 200


def test_vacancy_requests_restricted_hr_admin_scoped_to_one_department(
    client, db_session, campus_factory, department_factory, user_factory, department_scope_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"Dept A {uuid.uuid4().hex[:6]}")
    dept_b = department_factory("SSE", name=f"Dept B {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    vr_a = _make_vr(db_session, campus, dept_a, hod)
    vr_b = _make_vr(db_session, campus, dept_b, hod)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    department_scope_factory(hr_admin, dept_a)

    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(vr_a.id) in ids
    assert str(vr_b.id) not in ids

    get_a = client.get(f"/api/v1/vacancy-requests/{vr_a.id}", headers=auth_headers(client, hr_admin))
    assert get_a.status_code == 200
    get_b = client.get(f"/api/v1/vacancy-requests/{vr_b.id}", headers=auth_headers(client, hr_admin))
    assert get_b.status_code == 404


def test_vacancy_requests_super_admin_always_unrestricted(
    client, db_session, campus_factory, department_factory, user_factory, department_scope_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"Dept A {uuid.uuid4().hex[:6]}")
    dept_b = department_factory("SSE", name=f"Dept B {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    vr_b = _make_vr(db_session, campus, dept_b, hod)

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    # Even a (deliberately unrealistic) configured scope must never restrict
    # SUPER_ADMIN -- the unconditional bypass in get_department_scope.
    department_scope_factory(super_admin, dept_a)

    get_b = client.get(f"/api/v1/vacancy-requests/{vr_b.id}", headers=auth_headers(client, super_admin))
    assert get_b.status_code == 200

    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, super_admin))
    assert response.status_code == 200
    assert str(vr_b.id) in {item["id"] for item in response.json()["items"]}


def test_vacancy_requests_campus_hod_unrestricted_despite_department_scope_rows(
    client, db_session, campus_factory, department_factory, user_factory, department_scope_factory
):
    """Mirrors the real hod.sse@example.com/hod.scad@example.com state: a
    CAMPUS_HOD (outside GLOBAL_SCOPE_ROLES) with configured
    user_department_scope rows must not be restricted by this mechanism --
    only CampusScope applies to it, unchanged."""
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"Dept A {uuid.uuid4().hex[:6]}")
    dept_b = department_factory("SSE", name=f"Dept B {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    vr_b = _make_vr(db_session, campus, dept_b, hod)

    # hod has a department-scope row for dept_a only, but requests a VR from
    # dept_b (same campus) -- must still succeed since CAMPUS_HOD is outside
    # GLOBAL_SCOPE_ROLES and therefore unrestricted by this mechanism.
    department_scope_factory(hod, dept_a)

    get_b = client.get(f"/api/v1/vacancy-requests/{vr_b.id}", headers=auth_headers(client, hod))
    assert get_b.status_code == 200


# =========================================================================
# 2. employees.py
# =========================================================================


def test_employees_unrestricted_hr_admin_sees_both_departments(
    client, published_vacancy_factory, hired_employee_factory, user_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_a = hired_employee_factory(vacancy_a)
    hired_b = hired_employee_factory(vacancy_b)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/employees", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(hired_a.employee.id) in ids
    assert str(hired_b.employee.id) in ids

    get_b = client.get(f"/api/v1/employees/{hired_b.employee.id}", headers=auth_headers(client, hr_admin))
    assert get_b.status_code == 200


def test_employees_restricted_hr_admin_scoped_to_one_department(
    client, published_vacancy_factory, hired_employee_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_a = hired_employee_factory(vacancy_a)
    hired_b = hired_employee_factory(vacancy_b)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    department_scope_factory(hr_admin, vacancy_a.department)

    response = client.get("/api/v1/employees", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(hired_a.employee.id) in ids
    assert str(hired_b.employee.id) not in ids

    get_a = client.get(f"/api/v1/employees/{hired_a.employee.id}", headers=auth_headers(client, hr_admin))
    assert get_a.status_code == 200
    get_b = client.get(f"/api/v1/employees/{hired_b.employee.id}", headers=auth_headers(client, hr_admin))
    assert get_b.status_code == 404


def test_employees_super_admin_always_unrestricted(
    client, published_vacancy_factory, hired_employee_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_b = hired_employee_factory(vacancy_b)

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    department_scope_factory(super_admin, vacancy_a.department)

    get_b = client.get(f"/api/v1/employees/{hired_b.employee.id}", headers=auth_headers(client, super_admin))
    assert get_b.status_code == 200


def test_employees_campus_hod_unrestricted_despite_department_scope_rows(
    client, published_vacancy_factory, hired_employee_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_b = hired_employee_factory(vacancy_b)

    # vacancy_a.hod is a CAMPUS_HOD on the same (SSE) campus as vacancy_b --
    # scoped to dept_a only, but must still reach an employee in dept_b.
    department_scope_factory(vacancy_a.hod, vacancy_a.department)

    get_b = client.get(f"/api/v1/employees/{hired_b.employee.id}", headers=auth_headers(client, vacancy_a.hod))
    assert get_b.status_code == 200


# =========================================================================
# 3. sanctioned_strength.py
# =========================================================================


def test_sanctioned_strength_unrestricted_hr_admin_sees_both_departments(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"SS Dept A {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_b = department_factory("SSE", name=f"SS Dept B {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_a = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role A", department=dept_a)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role B", department=dept_b)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row_a = sanctioned_strength_factory(campus=campus, department=dept_a, designation=designation_a, created_by=hr_admin)
    row_b = sanctioned_strength_factory(campus=campus, department=dept_b, designation=designation_b, created_by=hr_admin)

    response = client.get(
        "/api/v1/sanctioned-strength/views/teaching", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200
    names = {r["designation_name"] for r in response.json()["items"]}
    assert "Role A" in names
    assert "Role B" in names

    history_b = client.get(
        f"/api/v1/sanctioned-strength/{row_b.id}/history", headers=auth_headers(client, hr_admin)
    )
    assert history_b.status_code == 200


def test_sanctioned_strength_restricted_hr_admin_scoped_to_one_department(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, department_scope_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"SS Dept A {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_b = department_factory("SSE", name=f"SS Dept B {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_a = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role A", department=dept_a)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role B", department=dept_b)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row_a = sanctioned_strength_factory(campus=campus, department=dept_a, designation=designation_a, created_by=hr_admin)
    row_b = sanctioned_strength_factory(campus=campus, department=dept_b, designation=designation_b, created_by=hr_admin)

    department_scope_factory(hr_admin, dept_a)

    response = client.get(
        "/api/v1/sanctioned-strength/views/teaching", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200
    names = {r["designation_name"] for r in response.json()["items"]}
    assert "Role A" in names
    assert "Role B" not in names

    history_a = client.get(
        f"/api/v1/sanctioned-strength/{row_a.id}/history", headers=auth_headers(client, hr_admin)
    )
    assert history_a.status_code == 200
    history_b = client.get(
        f"/api/v1/sanctioned-strength/{row_b.id}/history", headers=auth_headers(client, hr_admin)
    )
    assert history_b.status_code == 404

    update_b = client.patch(
        f"/api/v1/sanctioned-strength/{row_b.id}",
        json={"approved_strength": 9},
        headers=auth_headers(client, hr_admin),
    )
    assert update_b.status_code == 404

    availability_b = client.get(
        "/api/v1/sanctioned-strength/availability",
        headers=auth_headers(client, hr_admin),
        params={
            "campus_id": str(campus.id),
            "department_id": str(dept_b.id),
            "designation_id": str(designation_b.id),
        },
    )
    assert availability_b.status_code == 404


def test_sanctioned_strength_super_admin_always_unrestricted(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, department_scope_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"SS Dept A {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_b = department_factory("SSE", name=f"SS Dept B {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role B", department=dept_b)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row_b = sanctioned_strength_factory(campus=campus, department=dept_b, designation=designation_b, created_by=hr_admin)

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    department_scope_factory(super_admin, dept_a)

    history_b = client.get(
        f"/api/v1/sanctioned-strength/{row_b.id}/history", headers=auth_headers(client, super_admin)
    )
    assert history_b.status_code == 200


def test_sanctioned_strength_campus_hod_unrestricted_despite_department_scope_rows(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, department_scope_factory
):
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"SS Dept A {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    dept_b = department_factory("SSE", name=f"SS Dept B {uuid.uuid4().hex[:6]}", category=StaffRoleCategoryEnum.TEACHING)
    designation_b = designation_factory(StaffRoleCategoryEnum.TEACHING, name="Role B", department=dept_b)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row_b = sanctioned_strength_factory(campus=campus, department=dept_b, designation=designation_b, created_by=hr_admin)

    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    department_scope_factory(hod, dept_a)

    history_b = client.get(
        f"/api/v1/sanctioned-strength/{row_b.id}/history", headers=auth_headers(client, hod)
    )
    assert history_b.status_code == 200


# =========================================================================
# 4. job_postings.py
# =========================================================================


def test_job_postings_unrestricted_hr_admin_sees_both_departments(
    client, published_vacancy_factory, user_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/job-postings", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(vacancy_a.job_posting.id) in ids
    assert str(vacancy_b.job_posting.id) in ids

    get_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}", headers=auth_headers(client, hr_admin)
    )
    assert get_b.status_code == 200


def test_job_postings_restricted_hr_admin_scoped_to_one_department(
    client, published_vacancy_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    department_scope_factory(hr_admin, vacancy_a.department)

    response = client.get("/api/v1/job-postings", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(vacancy_a.job_posting.id) in ids
    assert str(vacancy_b.job_posting.id) not in ids

    get_a = client.get(
        f"/api/v1/job-postings/{vacancy_a.job_posting.id}", headers=auth_headers(client, hr_admin)
    )
    assert get_a.status_code == 200
    get_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}", headers=auth_headers(client, hr_admin)
    )
    assert get_b.status_code == 404

    ranking_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/candidate-ranking",
        headers=auth_headers(client, hr_admin),
    )
    assert ranking_b.status_code == 404


def test_job_postings_super_admin_always_unrestricted(
    client, published_vacancy_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    department_scope_factory(super_admin, vacancy_a.department)

    get_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}", headers=auth_headers(client, super_admin)
    )
    assert get_b.status_code == 200


def test_job_postings_campus_hod_unrestricted_despite_department_scope_rows(
    client, published_vacancy_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    department_scope_factory(vacancy_a.hod, vacancy_a.department)

    get_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}", headers=auth_headers(client, vacancy_a.hod)
    )
    assert get_b.status_code == 200


# =========================================================================
# 5. job_distribution.py
# =========================================================================


def test_job_distribution_unrestricted_hr_admin_reaches_both_departments(
    client, published_vacancy_factory, user_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    ad_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/ad", headers=auth_headers(client, hr_admin)
    )
    assert ad_b.status_code == 200
    ad_a = client.get(
        f"/api/v1/job-postings/{vacancy_a.job_posting.id}/ad", headers=auth_headers(client, hr_admin)
    )
    assert ad_a.status_code == 200


def test_job_distribution_restricted_hr_admin_scoped_to_one_department(
    client, published_vacancy_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    department_scope_factory(hr_admin, vacancy_a.department)

    ad_a = client.get(
        f"/api/v1/job-postings/{vacancy_a.job_posting.id}/ad", headers=auth_headers(client, hr_admin)
    )
    assert ad_a.status_code == 200
    ad_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/ad", headers=auth_headers(client, hr_admin)
    )
    assert ad_b.status_code == 404

    qr_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/qr-code", headers=auth_headers(client, hr_admin)
    )
    assert qr_b.status_code == 404


def test_job_distribution_super_admin_always_unrestricted(
    client, published_vacancy_factory, user_factory, department_scope_factory
):
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    department_scope_factory(super_admin, vacancy_a.department)

    ad_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/ad", headers=auth_headers(client, super_admin)
    )
    assert ad_b.status_code == 200


def test_job_distribution_recruitment_officer_unrestricted_despite_department_scope_rows(
    client, published_vacancy_factory, department_scope_factory
):
    # RECRUITMENT_OFFICER (outside GLOBAL_SCOPE_ROLES, and holds
    # JOB_DISTRIBUTION by default -- unlike CAMPUS_HOD, which never reaches
    # this router's own require_permission(JOB_DISTRIBUTION) gate at all).
    vacancy_a = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_b = published_vacancy_factory(campus_code="SSE", slot_count=1)

    department_scope_factory(vacancy_a.recruitment_officer, vacancy_a.department)

    ad_b = client.get(
        f"/api/v1/job-postings/{vacancy_b.job_posting.id}/ad",
        headers=auth_headers(client, vacancy_a.recruitment_officer),
    )
    assert ad_b.status_code == 200


# --- Recruitment Coordinator campus + department scope --------------------
#
# RECRUITMENT_COORDINATOR was moved out of GLOBAL_SCOPE_ROLES on 2026-09-01
# and back in on 2026-09-03, both at the user's request. These two pin BOTH
# halves -- campus visibility and department narrowing -- because a careless
# version of either move changes one half and silently regresses the other.


def test_coordinator_sees_every_campus(
    client, db_session, campus_factory, department_factory, user_factory
):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    sse_dept = department_factory("SSE", name=f"SSE Dept {uuid.uuid4().hex[:6]}")
    scad_dept = department_factory("SCAD", name=f"SCAD Dept {uuid.uuid4().hex[:6]}")
    sse_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    scad_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")
    sse_vr = _make_vr(db_session, sse, sse_dept, sse_hod)
    scad_vr = _make_vr(db_session, scad, scad_dept, scad_hod)

    # A home campus is still recorded on the user; it no longer scopes reads.
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")

    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, coordinator))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(sse_vr.id) in ids
    assert str(scad_vr.id) in ids

    assert (
        client.get(f"/api/v1/vacancy-requests/{scad_vr.id}", headers=auth_headers(client, coordinator))
    ).status_code == 200


def test_coordinator_is_still_department_scopable_within_their_campus(
    client, db_session, campus_factory, department_factory, user_factory, department_scope_factory
):
    # The regression guard. Department narrowing is gated on
    # DEPARTMENT_SCOPABLE_ROLES, not on campus scope; whichever set the
    # coordinator's campus visibility lives in, a department scope must
    # still apply.
    campus = campus_factory("SSE")
    dept_a = department_factory("SSE", name=f"Dept A {uuid.uuid4().hex[:6]}")
    dept_b = department_factory("SSE", name=f"Dept B {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    vr_a = _make_vr(db_session, campus, dept_a, hod)
    vr_b = _make_vr(db_session, campus, dept_b, hod)

    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    department_scope_factory(coordinator, dept_a)

    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, coordinator))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert str(vr_a.id) in ids
    assert str(vr_b.id) not in ids

    assert (
        client.get(f"/api/v1/vacancy-requests/{vr_b.id}", headers=auth_headers(client, coordinator))
    ).status_code == 404
