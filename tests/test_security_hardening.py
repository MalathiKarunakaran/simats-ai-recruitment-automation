from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.rate_limit import RateLimiter
from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers
from tests.test_joining_onboarding import _drive_to_joining_pending, _mark_all_documents_received


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
    refresh_token = login.json()["refresh_token"]

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert response.status_code == 200

    row = db_session.query(AuditLog).filter(AuditLog.action == "TOKEN_REFRESHED").one()
    assert row.actor_user_id == user.id


def test_mark_joined_writes_joining_record_audit_row(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_pending(client, vacancy, application)

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
    _drive_to_joining_pending(client, vacancy, application)
    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    _mark_all_documents_received(client, vacancy, application.id)

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-onboarding",
        headers=auth_headers(client, vacancy.hr_admin),
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
