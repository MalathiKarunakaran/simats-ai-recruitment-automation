from app.models.enums import UserRoleEnum


def test_otp_request_existing_email_returns_generic_response(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/otp-request", json={"email": user.email})
    assert response.status_code == 200
    assert "detail" in response.json()


def test_otp_request_unknown_email_returns_identical_response(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    known = client.post("/api/v1/auth/otp-request", json={"email": user.email})
    unknown = client.post("/api/v1/auth/otp-request", json={"email": "nobody@example.com"})
    assert unknown.status_code == 200
    assert unknown.json() == known.json()


def test_otp_request_deactivated_user_returns_generic_response_without_creating_a_code(
    client, user_factory, db_session
):
    from app.models.auth_token import LoginOtp

    user = user_factory(UserRoleEnum.HR_ADMIN, is_active=False)
    response = client.post("/api/v1/auth/otp-request", json={"email": user.email})
    assert response.status_code == 200
    assert db_session.query(LoginOtp).filter(LoginOtp.user_id == user.id).count() == 0


def test_otp_verify_correct_code_returns_token_pair(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    code = login_otp_factory(user)

    response = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_otp_verify_wrong_code_rejected(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login_otp_factory(user, code="123456")

    response = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": "999999"})
    assert response.status_code == 401


def test_otp_verify_expired_code_rejected(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    code = login_otp_factory(user, expired=True)

    response = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert response.status_code == 401


def test_otp_verify_code_is_single_use(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    code = login_otp_factory(user)

    first = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert first.status_code == 200

    second = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert second.status_code == 401


def test_otp_verify_nonexistent_email_rejected_with_same_message_as_wrong_code(
    client, user_factory, login_otp_factory
):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login_otp_factory(user, code="123456")

    wrong_code_resp = client.post(
        "/api/v1/auth/otp-verify", json={"email": user.email, "code": "999999"}
    )
    nonexistent_resp = client.post(
        "/api/v1/auth/otp-verify", json={"email": "nobody@example.com", "code": "123456"}
    )
    assert nonexistent_resp.status_code == 401
    assert nonexistent_resp.json()["detail"] == wrong_code_resp.json()["detail"]


def test_otp_verify_deactivated_user_rejected(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN, is_active=False)
    code = login_otp_factory(user)

    response = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert response.status_code == 401


def test_password_login_still_works_alongside_otp(client, user_factory):
    # OTP is additive, not a replacement -- password login must keep working.
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert response.status_code == 200
