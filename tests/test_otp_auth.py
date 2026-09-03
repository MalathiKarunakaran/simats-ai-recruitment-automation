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


# --- Production delivery rules (audit H1, 2026-09-03) -----------------------
#
# Outside production a missing mail integration prints the code/token to the
# server console (the dev fallback). In production that must never happen:
# the endpoint refuses with 503 before any user lookup, and nothing secret
# reaches stdout.

import pytest

from app.core.config import settings


class _RecordingN8n:
    def __init__(self):
        self.calls = []

    def post_webhook(self, name, payload):
        self.calls.append((name, payload))


@pytest.fixture()
def production(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "")


def test_prod_without_email_delivery_refuses_otp_request_and_logs_nothing(client, user_factory, production, capsys, db_session):
    from app.models.auth_token import LoginOtp

    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/otp-request", json={"email": user.email})

    assert response.status_code == 503
    assert "sign in with your password" in response.json()["detail"]
    assert "otp-login-stub" not in capsys.readouterr().out
    assert db_session.query(LoginOtp).filter(LoginOtp.user_id == user.id).count() == 0


def test_prod_without_email_delivery_answers_unknown_and_known_emails_identically(client, user_factory, production):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    known = client.post("/api/v1/auth/otp-request", json={"email": user.email})
    unknown = client.post("/api/v1/auth/otp-request", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 503
    assert known.json() == unknown.json()


def test_prod_without_email_delivery_refuses_password_reset_and_logs_nothing(client, user_factory, production, capsys, db_session):
    from app.models.auth_token import PasswordResetToken

    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/password-reset-request", json={"email": user.email})

    assert response.status_code == 503
    assert "contact an administrator" in response.json()["detail"]
    assert "password-reset-stub" not in capsys.readouterr().out
    assert db_session.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).count() == 0


def test_prod_with_email_delivery_sends_the_otp_through_n8n_and_logs_nothing(client, user_factory, monkeypatch, capsys):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "https://n8n.example.com")
    n8n = _RecordingN8n()
    monkeypatch.setattr("app.api.v1.routers.auth.get_n8n_client", lambda: n8n)

    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/otp-request", json={"email": user.email})

    assert response.status_code == 200
    assert [name for name, _ in n8n.calls] == ["send-otp-email"]
    payload = n8n.calls[0][1]
    assert payload["to"] == user.email and len(payload["code"]) == 6
    assert payload["code"] not in capsys.readouterr().out


def test_prod_with_email_delivery_that_fails_refuses_rather_than_printing(client, user_factory, monkeypatch, capsys):
    import httpx

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "https://n8n.example.com")

    class _Broken:
        def post_webhook(self, name, payload):
            raise httpx.ConnectError("n8n down")

    monkeypatch.setattr("app.api.v1.routers.auth.get_n8n_client", lambda: _Broken())
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/otp-request", json={"email": user.email})

    assert response.status_code == 503
    assert "otp-login-stub" not in capsys.readouterr().out


def test_password_login_is_unaffected_in_prod_without_email_delivery(client, user_factory, production):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post("/api/v1/auth/login", data={"username": user.email, "password": user.plain_password})
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_development_keeps_the_console_fallback(client, user_factory, monkeypatch, capsys):
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "")
    user = user_factory(UserRoleEnum.HR_ADMIN)

    assert client.post("/api/v1/auth/otp-request", json={"email": user.email}).status_code == 200
    assert client.post("/api/v1/auth/password-reset-request", json={"email": user.email}).status_code == 200
    out = capsys.readouterr().out
    assert "[otp-login-stub]" in out and "[password-reset-stub]" in out


def test_login_options_reflect_delivery_state(client, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "")
    assert client.get("/api/v1/auth/login-options").json() == {"password_login": True, "otp_email_login": False}

    monkeypatch.setattr(settings, "N8N_BASE_URL", "https://n8n.example.com")
    assert client.get("/api/v1/auth/login-options").json()["otp_email_login"] is True

    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "N8N_BASE_URL", "")
    assert client.get("/api/v1/auth/login-options").json()["otp_email_login"] is True
