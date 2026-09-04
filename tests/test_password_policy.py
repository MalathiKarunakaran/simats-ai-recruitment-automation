"""Audit L2 (2026-09-04): one password policy, a 12-character minimum,
enforced on every path that sets a password. Login is deliberately not
covered: an existing shorter password keeps working until it is changed.
"""

import pytest

from app.models.enums import UserRoleEnum
from app.schemas.user import PASSWORD_MIN_LENGTH

from tests.conftest import auth_headers

ELEVEN = "Abcdefghij1"  # PASSWORD_MIN_LENGTH - 1
TWELVE = "Abcdefghij12"  # exactly PASSWORD_MIN_LENGTH


def test_the_policy_is_twelve_characters():
    assert PASSWORD_MIN_LENGTH == 12
    assert len(ELEVEN) == 11 and len(TWELVE) == 12


def _create_payload(password):
    return {
        "email": "policy.check@example.com",
        "full_name": "Policy Check",
        "role": "HR_ADMIN",
        "password": password,
    }


@pytest.mark.parametrize("password,expected", [(ELEVEN, 422), (TWELVE, 201)])
def test_user_creation_enforces_the_minimum(client, user_factory, password, expected):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post("/api/v1/users", headers=auth_headers(client, admin), json=_create_payload(password))
    assert response.status_code == expected, response.text


@pytest.mark.parametrize("password,expected", [(ELEVEN, 422), (TWELVE, 200)])
def test_self_service_change_enforces_the_minimum(client, user_factory, password, expected):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.patch("/api/v1/users/me", headers=auth_headers(client, user), json={"password": password})
    assert response.status_code == expected, response.text


@pytest.mark.parametrize("password,expected", [(ELEVEN, 422), (TWELVE, 200)])
def test_admin_reset_enforces_the_minimum(client, user_factory, password, expected):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.post(
        f"/api/v1/users/{target.id}/reset-password", headers=auth_headers(client, admin), json={"password": password}
    )
    assert response.status_code == expected, response.text


@pytest.mark.parametrize("password,expected", [(ELEVEN, 422), (TWELVE, 204)])
def test_emailed_reset_enforces_the_minimum(client, user_factory, password_reset_token_factory, password, expected):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    token = password_reset_token_factory(user)
    response = client.post("/api/v1/auth/password-reset-confirm", json={"token": token, "new_password": password})
    assert response.status_code == expected, response.text


def test_existing_shorter_password_still_logs_in(client, user_factory):
    # The policy applies when a password is SET; accounts created before it
    # keep working and are brought up to the rule the next time they change it.
    user = user_factory(UserRoleEnum.HR_ADMIN, password="Short8ch")
    response = client.post("/api/v1/auth/login", data={"username": user.email, "password": "Short8ch"})
    assert response.status_code == 200, response.text
