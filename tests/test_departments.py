from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers


def test_hod_cannot_create_department_anymore(client, user_factory, campus_factory):
    # Campus HOD lost department-write access with the Department/Designation
    # Master rollout (confirmed decision) -- only SUPER_ADMIN/HR_ADMIN can
    # write departments now.
    sse = campus_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, hod),
        json={"campus_id": str(sse.id), "name": "Computer Science"},
    )
    assert response.status_code == 403


def test_hr_admin_can_create_department_with_master_fields(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "name": "Computer Science",
            "code": "CSE",
            "category": "TEACHING",
            "parent_group": "Engineering",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["campus_id"] == str(sse.id)
    assert body["code"] == "CSE"
    assert body["category"] == "TEACHING"
    assert body["parent_group"] == "Engineering"


def test_super_admin_can_patch_department_master_fields(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create_response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, super_admin),
        json={"campus_id": str(sse.id), "name": "Mechanical Engineering"},
    )
    assert create_response.status_code == 201
    department_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/departments/{department_id}",
        headers=auth_headers(client, super_admin),
        json={"code": "MECH", "category": "NON_TEACHING", "parent_group": "Engineering"},
    )
    assert patch_response.status_code == 200, patch_response.text
    body = patch_response.json()
    assert body["code"] == "MECH"
    assert body["category"] == "NON_TEACHING"
    assert body["parent_group"] == "Engineering"


def test_hod_cannot_patch_department_anymore(client, user_factory, campus_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.patch(
        f"/api/v1/departments/{department.id}",
        headers=auth_headers(client, hod),
        json={"code": "X"},
    )
    assert response.status_code == 403


def test_department_list_is_campus_scoped_for_hod(client, user_factory, campus_factory, db_session):
    from app.models.department import Department

    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    db_session.add_all(
        [
            Department(campus_id=sse.id, name="SSE Dept"),
            Department(campus_id=scad.id, name="SCAD Dept"),
        ]
    )
    db_session.flush()

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/departments", headers=auth_headers(client, hod_sse))
    names = {d["name"] for d in response.json()["items"]}
    assert "SSE Dept" in names
    assert "SCAD Dept" not in names


def test_candidate_cannot_list_departments(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/departments", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_create_department_without_category_defaults_to_non_teaching(client, user_factory, campus_factory):
    # Department.category became NOT NULL in the Phase 1 staff-category
    # migrations (see alembic/versions/a1b2c3d4e5f7_..._backfill_department_category.py)
    # -- the API still accepts an omitted category (mirroring that
    # migration's own "ambiguous -> NON_TEACHING" default) rather than 422ing,
    # since the RBAC test above relies on a category-less payload still
    # reaching the role check.
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, hr_admin),
        json={"campus_id": str(sse.id), "name": "New Dept Without Category"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["category"] == StaffRoleCategoryEnum.NON_TEACHING.value


def test_department_factory_departments_have_a_category(department_factory):
    # Model-level Python default (StaffRoleCategoryEnum.NON_TEACHING) keeps
    # every existing Department(...) construction site working now that the
    # column is NOT NULL, without needing to touch every call site.
    department = department_factory("SSE")
    assert department.category == StaffRoleCategoryEnum.NON_TEACHING
