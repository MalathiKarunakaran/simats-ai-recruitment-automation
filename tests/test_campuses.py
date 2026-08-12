from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_any_authenticated_role_can_list_campuses(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/campuses", headers=auth_headers(client, candidate))
    assert response.status_code == 200


def test_hr_admin_cannot_create_campus(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/campuses",
        headers=auth_headers(client, hr_admin),
        json={"code": "SSE", "name": "Test"},
    )
    assert response.status_code == 403


def test_super_admin_can_create_and_update_campus(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)

    created = client.post(
        "/api/v1/campuses", headers=headers, json={"code": "STUDIO", "name": "Studio Campus"}
    )
    assert created.status_code == 201
    campus_id = created.json()["id"]

    updated = client.patch(
        f"/api/v1/campuses/{campus_id}", headers=headers, json={"name": "Studio Campus (Updated)"}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Studio Campus (Updated)"


def test_campus_code_outside_allowlist_rejected(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/campuses",
        headers=auth_headers(client, admin),
        json={"code": "NOTREAL", "name": "Fake Campus"},
    )
    assert response.status_code == 400


def test_hr_admin_cannot_delete_campus(client, user_factory, campus_factory):
    campus = campus_factory("SPIER")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 403


def test_super_admin_can_delete_campus_with_no_dependents(client, user_factory, campus_factory):
    campus = campus_factory("STUDIO")
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, admin))
    assert response.status_code == 204

    get_response = client.get(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, admin))
    assert get_response.status_code == 200
    assert get_response.json()["is_active"] is False


def test_delete_campus_blocked_by_active_department(client, user_factory, department_factory):
    department = department_factory("SCAD")
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.delete(f"/api/v1/campuses/{department.campus_id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "department" in response.json()["detail"]


def test_delete_campus_blocked_by_active_user(client, user_factory, campus_factory):
    campus = campus_factory("SSPE")
    staff = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSPE")
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "user" in response.json()["detail"]
    assert staff.campus_id == campus.id


def test_delete_campus_not_blocked_by_inactive_department(client, user_factory, department_factory, db_session):
    department = department_factory("SCLAS")
    department.is_active = False
    db_session.flush()
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.delete(f"/api/v1/campuses/{department.campus_id}", headers=auth_headers(client, admin))
    assert response.status_code == 204


def test_delete_unknown_campus_returns_404(client, user_factory):
    import uuid

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.delete(f"/api/v1/campuses/{uuid.uuid4()}", headers=auth_headers(client, admin))
    assert response.status_code == 404
