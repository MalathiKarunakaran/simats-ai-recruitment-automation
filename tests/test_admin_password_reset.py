from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers, refresh_session, session_cookie


def test_super_admin_resets_another_users_password(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["must_change_password"] is True
    assert body["id"] == str(target.id)


def test_hr_admin_cannot_reset_password(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, hr_admin),
        json={"password": "BrandNewPass123!"},
    )
    assert response.status_code == 403


def test_reset_password_unknown_user_id_returns_404(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert response.status_code == 404


def test_reset_password_too_short_returns_422(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "short"},
    )
    assert response.status_code == 422


def test_reset_password_revokes_existing_refresh_token(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    login = client.post(
        "/api/v1/auth/login", data={"username": target.email, "password": target.plain_password}
    )
    assert login.status_code == 200
    target_refresh = session_cookie(client)

    reset_response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert reset_response.status_code == 200

    refresh_attempt = refresh_session(client, target_refresh)
    assert refresh_attempt.status_code == 401


def test_login_with_new_password_reports_must_change_password(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    reset_response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert reset_response.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        data={"username": target.email, "password": "BrandNewPass123!"},
    )
    assert login.status_code == 200
    body = login.json()
    assert body["must_change_password"] is True


def _login_and_get_access_token(client, target, password: str) -> str:
    login = client.post(
        "/api/v1/auth/login",
        data={"username": target.email, "password": password},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def test_forced_reset_user_blocked_from_non_allowlisted_endpoint(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    reset_response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert reset_response.status_code == 200

    access_token = _login_and_get_access_token(client, target, "BrandNewPass123!")
    headers = {"Authorization": f"Bearer {access_token}"}

    blocked = client.get("/api/v1/users", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"


def test_forced_reset_user_can_change_password_then_use_api_normally(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    reset_response = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert reset_response.status_code == 200

    access_token = _login_and_get_access_token(client, target, "BrandNewPass123!")
    headers = {"Authorization": f"Bearer {access_token}"}

    # Allowlisted endpoint works even while must_change_password is set.
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True

    change = client.patch(
        "/api/v1/users/me", headers=headers, json={"password": "FinalPassword123!"}
    )
    assert change.status_code == 200
    assert change.json()["must_change_password"] is False

    # Audit M3: a password change ends every session, this one included --
    # the token that made the change is refused from here on. The app
    # signs in again with the new password (AuthContext.saveOwnProfile).
    assert client.get("/api/v1/users", headers=headers).status_code == 401

    fresh = {"Authorization": f"Bearer {_login_and_get_access_token(client, target, 'FinalPassword123!')}"}
    # Flag cleared -- a non-allowlisted endpoint now works on the new session.
    normal_call = client.get("/api/v1/users", headers=fresh)
    assert normal_call.status_code == 200
