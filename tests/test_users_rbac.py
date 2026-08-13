from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_super_admin_lists_users_across_all_campuses(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, admin))
    assert response.status_code == 200
    emails = {u["email"] for u in response.json()["items"]}
    assert admin.email in emails
    assert len(response.json()["items"]) >= 3


def test_associate_dean_sees_all_campuses_like_super_admin(client, user_factory):
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, dean))
    emails = {u["email"] for u in response.json()["items"]}
    assert hod_sse.email in emails
    assert hod_scad.email in emails


def test_hod_list_excludes_other_campus_users(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    emails = {u["email"] for u in response.json()["items"]}
    assert hod_sse.email in emails
    assert hod_scad.email not in emails


def test_hod_get_cross_campus_user_returns_404_not_403(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get(f"/api/v1/users/{hod_scad.id}", headers=auth_headers(client, hod_sse))
    assert response.status_code == 404


def test_hod_get_same_campus_user_succeeds(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer_sse = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.get(f"/api/v1/users/{officer_sse.id}", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    assert response.json()["email"] == officer_sse.email


def test_hod_cannot_create_users(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, hod_sse),
        json={
            "email": "new.person@example.com",
            "password": "SomePass123!",
            "full_name": "New Person",
            "role": "CANDIDATE",
        },
    )
    assert response.status_code == 403


def test_super_admin_can_create_users(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "new.person@example.com",
            "password": "SomePass123!",
            "full_name": "New Person",
            "role": "CANDIDATE",
        },
    )
    assert response.status_code == 201
    assert response.json()["email"] == "new.person@example.com"


def test_candidate_cannot_list_users(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/users", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_no_auth_header_rejected(client):
    assert client.get("/api/v1/users").status_code == 401


def test_tampered_access_token_rejected(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)
    tampered = headers["Authorization"] + "tampered"
    response = client.get("/api/v1/users", headers={"Authorization": tampered})
    assert response.status_code == 401


def test_user_can_read_own_profile_via_users_me(client, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/users/me", headers=auth_headers(client, hod))
    assert response.status_code == 200
    assert response.json()["email"] == hod.email


def test_delete_users_route_no_longer_exists(client, user_factory):
    """DELETE /users/{id} was dead code -- the frontend never called it and
    PATCH /users/{id} (is_active=False) is the one real deactivate path.
    Regression guard against silently reintroducing it."""
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert response.status_code == 405
