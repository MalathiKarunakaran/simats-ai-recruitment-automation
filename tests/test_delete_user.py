from app.core import security
from app.models.auth_token import RefreshToken
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers


def test_delete_fresh_user_succeeds(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert response.status_code == 204

    get_response = client.get(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert get_response.status_code == 404


def test_delete_blocked_by_audit_log_actor_history(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    # Logging in creates a real AuditLog row with actor_user_id == target.id
    # (auth.py's login success path calls log_auth_event).
    login = client.post(
        "/api/v1/auth/login", data={"username": target.email, "password": target.plain_password}
    )
    assert login.status_code == 200

    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "related recruitment, interview, or audit history" in response.json()["detail"]


def test_delete_blocked_by_business_record_reference(
    client, user_factory, department_factory, db_session
):
    # One representative table beyond AuditLog -- the full list of 23
    # checked FK columns lives in app/api/v1/routers/users.py's
    # _user_has_related_records helper.
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    department = department_factory("SSE", "Computer Science", category=StaffRoleCategoryEnum.TEACHING)

    vacancy_request = VacancyRequest(
        campus_id=department.campus_id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title="Assistant Professor",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=1,
        qualification="PhD",
        experience_required="3+ years",
        requested_by_id=target.id,
    )
    db_session.add(vacancy_request)
    db_session.flush()

    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "related recruitment, interview, or audit history" in response.json()["detail"]


def test_delete_super_admin_target_blocked(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    other_super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.delete(
        f"/api/v1/users/{other_super_admin.id}", headers=auth_headers(client, admin)
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Super Admin accounts cannot be deleted."


def test_delete_deactivation_protected_target_blocked(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    protected = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    protected.deactivation_protected = True

    response = client.delete(f"/api/v1/users/{protected.id}", headers=auth_headers(client, admin))
    assert response.status_code == 400
    assert response.json()["detail"] == "This account is protected and cannot be deleted."


def test_hr_admin_cannot_delete_user(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 403


def test_delete_unknown_user_id_returns_404(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.delete(
        "/api/v1/users/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(client, admin),
    )
    assert response.status_code == 404


def test_delete_succeeds_with_only_refresh_token_rows(client, user_factory, db_session):
    # Confirms the deliberate CASCADE exclusion for auth_token.* rows --
    # session data alone must not block a hard delete. A row is inserted
    # directly (mirroring auth.py's _issue_token_pair) rather than via
    # POST /auth/login, since login also writes an AuditLog row that would
    # legitimately block deletion on its own.
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    db_session.add(
        RefreshToken(
            user_id=target.id,
            token_hash=security.hash_opaque_token(security.generate_opaque_token()),
            expires_at=security.refresh_token_expiry(),
        )
    )
    db_session.flush()

    response = client.delete(f"/api/v1/users/{target.id}", headers=auth_headers(client, admin))
    assert response.status_code == 204


def test_force_logout_revokes_active_session(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    login = client.post(
        "/api/v1/auth/login", data={"username": target.email, "password": target.plain_password}
    )
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]

    response = client.post(
        f"/api/v1/users/{target.id}/force-logout", headers=auth_headers(client, admin)
    )
    assert response.status_code == 204

    refresh_attempt = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert refresh_attempt.status_code == 401


def test_force_logout_requires_user_management_roles(client, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        f"/api/v1/users/{target.id}/force-logout", headers=auth_headers(client, hod)
    )
    assert response.status_code == 403


def test_force_logout_unknown_user_id_returns_404(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/force-logout",
        headers=auth_headers(client, admin),
    )
    assert response.status_code == 404
