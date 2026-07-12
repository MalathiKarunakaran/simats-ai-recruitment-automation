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
