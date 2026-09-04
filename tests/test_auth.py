from app.models.enums import UserRoleEnum

from tests.conftest import CSRF_HEADERS, DEFAULT_TEST_PASSWORD, auth_headers, refresh_session, session_cookie


def test_login_success_returns_token_pair(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    # Audit M1: the refresh token is an HttpOnly cookie, never in the body.
    assert "refresh_token" not in body
    assert session_cookie(client)
    assert body["token_type"] == "bearer"


def test_login_wrong_password_rejected(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": "wrong-password"}
    )
    assert response.status_code == 401


def test_login_nonexistent_email_rejected_with_same_message_as_wrong_password(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    wrong_password_resp = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": "wrong-password"}
    )
    nonexistent_resp = client.post(
        "/api/v1/auth/login", data={"username": "nobody@example.com", "password": "whatever"}
    )
    assert nonexistent_resp.status_code == 401
    assert nonexistent_resp.json()["detail"] == wrong_password_resp.json()["detail"]


def test_login_deactivated_user_rejected(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN, is_active=False)
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert response.status_code == 401


def test_refresh_issues_new_access_token(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    ).json()

    refreshed = refresh_session(client)
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"] != login["access_token"]


def test_refresh_token_revoked_by_logout_is_rejected(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    ).json()

    raw_refresh = session_cookie(client)
    logout = client.post(
        "/api/v1/auth/logout",
        headers={**CSRF_HEADERS, "Authorization": f"Bearer {login['access_token']}"},
    )
    assert logout.status_code == 204

    # Presenting the revoked token explicitly (the jar was cleared by logout).
    refreshed = refresh_session(client, raw_refresh)
    assert refreshed.status_code == 401


def test_password_reset_request_identical_response_for_existing_and_unknown_email(
    client, user_factory
):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    existing = client.post("/api/v1/auth/password-reset-request", json={"email": user.email})
    unknown = client.post(
        "/api/v1/auth/password-reset-request", json={"email": "nobody@example.com"}
    )
    assert existing.status_code == 200
    assert unknown.status_code == 200
    assert existing.json() == unknown.json()


def test_password_reset_confirm_changes_password_and_revokes_all_sessions(
    client, user_factory, password_reset_token_factory
):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert login.status_code == 200
    pre_reset_refresh = session_cookie(client)

    raw_token = password_reset_token_factory(user)
    new_password = "BrandNewPass456!"
    confirm = client.post(
        "/api/v1/auth/password-reset-confirm", json={"token": raw_token, "new_password": new_password}
    )
    assert confirm.status_code == 204

    old_password_login = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": DEFAULT_TEST_PASSWORD}
    )
    assert old_password_login.status_code == 401

    new_password_login = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": new_password}
    )
    assert new_password_login.status_code == 200

    # The refresh token issued before the reset must now be dead.
    old_refresh = refresh_session(client, pre_reset_refresh)
    assert old_refresh.status_code == 401


def test_password_reset_confirm_rejects_invalid_token(client):
    response = client.post(
        "/api/v1/auth/password-reset-confirm",
        json={"token": "not-a-real-token", "new_password": "SomethingNew123!"},
    )
    assert response.status_code == 400


def test_me_endpoint_requires_auth(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_endpoint_returns_current_user(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, user)
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["email"] == user.email
