from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.rate_limit import RateLimiter
from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers, refresh_session, session_cookie
from tests.test_joining_onboarding import _drive_to_joining_confirmed, _mark_all_documents_received


def _fake_request(ip: str = "9.9.9.9"):
    return SimpleNamespace(client=SimpleNamespace(host=ip))


def test_rate_limiter_blocks_past_threshold_and_is_per_key():
    limiter = RateLimiter(max_requests=3, window_seconds=60, name="unit-test")

    for _ in range(3):
        limiter(_fake_request("1.1.1.1"))
    with pytest.raises(HTTPException) as exc_info:
        limiter(_fake_request("1.1.1.1"))
    assert exc_info.value.status_code == 429

    # A different client IP has its own independent bucket.
    limiter(_fake_request("2.2.2.2"))


def test_login_rate_limit_returns_429_past_threshold(client):
    responses = [
        client.post("/api/v1/auth/login", data={"username": "nobody@example.com", "password": "wrong"})
        for _ in range(31)
    ]
    assert all(r.status_code == 401 for r in responses[:30])
    assert responses[30].status_code == 429


def test_password_reset_request_rate_limit_returns_429_past_threshold(client):
    responses = [
        client.post("/api/v1/auth/password-reset-request", json={"email": "nobody@example.com"}) for _ in range(6)
    ]
    assert all(r.status_code == 200 for r in responses[:5])
    assert responses[5].status_code == 429


def test_security_headers_present_on_response(client):
    response = client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    # Plain local HTTP -- HSTS must NOT be added (it would break local dev).
    assert "strict-transport-security" not in response.headers


def test_resume_upload_rejects_spoofed_content_type(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/resume",
        headers=auth_headers(client, hr_admin),
        files={"file": ("resume.pdf", b"not actually a pdf, just spoofed content-type", "application/pdf")},
    )
    assert response.status_code == 400
    assert "not a valid PDF" in response.json()["detail"]


def test_refresh_writes_token_refreshed_audit_row(client, user_factory, db_session):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = client.post("/api/v1/auth/login", data={"username": user.email, "password": user.plain_password})
    assert login.status_code == 200

    response = refresh_session(client)
    assert response.status_code == 200

    row = db_session.query(AuditLog).filter(AuditLog.action == "TOKEN_REFRESHED").one()
    assert row.actor_user_id == user.id


def test_mark_joined_writes_joining_record_audit_row(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200

    row = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "JoiningRecord", AuditLog.action == "UPDATE")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert row is not None
    assert row.after_state["actual_joining_date"] is not None


def test_complete_onboarding_writes_joining_record_audit_row(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)
    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    _mark_all_documents_received(client, vacancy, application.id)

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"department_id": str(vacancy.department.id)},
    )
    assert response.status_code == 200

    rows = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "JoiningRecord", AuditLog.action == "UPDATE")
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    onboarding_row = next(r for r in rows if "onboarding_completed_at" in r.after_state)
    assert onboarding_row.after_state["onboarding_completed_at"] is not None
    assert onboarding_row.after_state["onboarding_completed_by_id"] == str(vacancy.hr_admin.id)


# --- M5: interactive API docs are off in production unless overridden -----------


def test_api_docs_default_off_in_production_and_on_elsewhere(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "EXPOSE_API_DOCS", None)
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    assert settings.api_docs_enabled is True
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    assert settings.api_docs_enabled is False
    monkeypatch.setattr(settings, "EXPOSE_API_DOCS", True)
    assert settings.api_docs_enabled is True
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "EXPOSE_API_DOCS", False)
    assert settings.api_docs_enabled is False


def test_api_docs_are_served_outside_production(client, user_factory):
    # E + D: the development-shaped app (what the test suite runs) keeps all
    # three routes, and ordinary authenticated calls are unaffected.
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    user = user_factory(UserRoleEnum.HR_ADMIN)
    assert client.get("/api/v1/auth/me", headers=auth_headers(client, user)).status_code == 200


@pytest.fixture()
def production_shaped_app(monkeypatch):
    """The FastAPI object is built once at import from the settings of the
    moment, so the production shape needs a fresh build: flip the setting,
    reload app.main, hand back its app, then reload again to restore the
    development-shaped object every other test uses."""
    import importlib

    import app.main as main_module
    from app.core.config import settings

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "EXPOSE_API_DOCS", None)
    importlib.reload(main_module)
    try:
        yield main_module.app
    finally:
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        importlib.reload(main_module)


def test_production_serves_no_api_documentation_at_all(production_shaped_app):
    # A + B + C + F: every documentation route FastAPI can mount is gone,
    # including the OAuth2 redirect helper Swagger registers, while the API
    # itself is up. No auth-gated variant exists, so there is nothing an
    # ordinary user could reach either.
    from fastapi.testclient import TestClient

    with TestClient(production_shaped_app) as prod:
        assert prod.get("/health").status_code == 200
        for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
            response = prod.get(path)
            assert response.status_code == 404, path
            assert "swagger" not in response.text.lower() and "redoc" not in response.text.lower(), path
        # Nothing else in the route table serves a schema or a docs page.
        paths = [getattr(r, "path", "") for r in production_shaped_app.routes]
        assert not [p for p in paths if "docs" in p or "openapi" in p]


def test_production_docs_can_be_re_enabled_explicitly(monkeypatch):
    # The override exists for a deliberate, temporary debugging session only.
    import importlib

    import app.main as main_module
    from app.core.config import settings
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "EXPOSE_API_DOCS", True)
    importlib.reload(main_module)
    try:
        with TestClient(main_module.app) as prod:
            assert prod.get("/openapi.json").status_code == 200
    finally:
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(settings, "EXPOSE_API_DOCS", None)
        importlib.reload(main_module)
