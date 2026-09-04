"""Audit M3 (2026-09-04): an access token stops authorising the moment its
session is revoked, not at its own 30-minute expiry.

Mechanism: every access JWT carries `sid`, the refresh-token session family
it was issued with (`refresh_tokens.session_id`); `get_current_user` loads
the user through a join on that family's unrevoked row. Logout, force
logout, admin password reset and self-service password reset all revoke the
family's rows, and a password change revokes every OTHER family.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt

from app.core import security
from app.core.config import settings
from app.models.enums import UserRoleEnum

from tests.conftest import CSRF_HEADERS, auth_headers, refresh_session, session_cookie

ME = "/api/v1/auth/me"


def _login(client, user):
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _bearer(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


# A. / B. -----------------------------------------------------------------------


def test_login_issues_a_session_bound_access_token_that_works(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    access = _login(client, user)

    claims = jwt.decode(access, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    assert claims["type"] == "access"
    uuid.UUID(claims["sid"])  # present and well-formed

    assert client.get(ME, headers=_bearer(access)).status_code == 200


# C. / D. force logout ------------------------------------------------------------


def test_force_logout_rejects_the_existing_access_token_immediately(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    access = _login(client, target)
    assert client.get(ME, headers=_bearer(access)).status_code == 200

    forced = client.post(f"/api/v1/users/{target.id}/force-logout", headers=auth_headers(client, admin))
    assert forced.status_code == 204

    # Same token, still signed, still hours from exp: refused now.
    assert client.get(ME, headers=_bearer(access)).status_code == 401
    assert client.get(ME, headers=_bearer(access)).status_code == 401


def test_own_logout_rejects_the_access_token_of_that_session_immediately(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    access = _login(client, user)

    assert client.post("/api/v1/auth/logout", headers={**CSRF_HEADERS, **_bearer(access)}).status_code == 204
    assert client.get(ME, headers=_bearer(access)).status_code == 401


# E. a new token after revocation works ---------------------------------------------


def test_a_fresh_login_after_force_logout_works_while_the_old_token_stays_dead(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    old_access = _login(client, target)
    client.post(f"/api/v1/users/{target.id}/force-logout", headers=auth_headers(client, admin))

    new_access = _login(client, target)
    assert client.get(ME, headers=_bearer(new_access)).status_code == 200
    assert client.get(ME, headers=_bearer(old_access)).status_code == 401


# F. password change (self-service, while logged in) -------------------------------------


def test_password_change_rejects_access_tokens_of_other_sessions_but_keeps_the_current_one(
    client, user_factory
):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    other_session_access = _login(client, user)  # e.g. a phone
    current_access = _login(client, user)  # the browser changing the password
    assert client.get(ME, headers=_bearer(other_session_access)).status_code == 200

    changed = client.patch(
        "/api/v1/users/me", headers=_bearer(current_access), json={"password": "BrandNewPass456!"}
    )
    assert changed.status_code == 200, changed.text

    assert client.get(ME, headers=_bearer(other_session_access)).status_code == 401
    assert client.get(ME, headers=_bearer(current_access)).status_code == 200


# G. admin password reset ------------------------------------------------------------------


def test_admin_password_reset_rejects_the_existing_access_token_immediately(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    access = _login(client, target)

    reset = client.post(
        f"/api/v1/users/{target.id}/reset-password",
        headers=auth_headers(client, admin),
        json={"password": "BrandNewPass123!"},
    )
    assert reset.status_code == 200

    assert client.get(ME, headers=_bearer(access)).status_code == 401


# H. self-service password reset (forgot-password link) ----------------------------------------


def test_self_service_password_reset_rejects_the_existing_access_token_immediately(
    client, user_factory, password_reset_token_factory
):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    access = _login(client, user)
    raw_token = password_reset_token_factory(user)

    confirm = client.post(
        "/api/v1/auth/password-reset-confirm", json={"token": raw_token, "new_password": "BrandNewPass456!"}
    )
    assert confirm.status_code == 204

    assert client.get(ME, headers=_bearer(access)).status_code == 401


# I. refresh / restoration / multi-tab ----------------------------------------------------------


def test_refresh_keeps_the_session_family_so_an_earlier_tabs_token_still_works(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    tab_a_access = _login(client, user)

    refreshed = refresh_session(client)  # tab B bootstraps on the shared cookie
    assert refreshed.status_code == 200
    tab_b_access = refreshed.json()["access_token"]

    # Both tabs keep working: the rotation replaced the refresh token, not the session.
    assert client.get(ME, headers=_bearer(tab_a_access)).status_code == 200
    assert client.get(ME, headers=_bearer(tab_b_access)).status_code == 200

    # A later refresh still works (session restoration on reload).
    assert refresh_session(client).status_code == 200


def test_deactivated_user_is_still_refused_immediately(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    access = _login(client, target)

    deactivated = client.patch(
        f"/api/v1/users/{target.id}", headers=auth_headers(client, admin), json={"is_active": False}
    )
    assert deactivated.status_code == 200, deactivated.text
    assert client.get(ME, headers=_bearer(access)).status_code in (401, 403)


# Token-shape guards -------------------------------------------------------------------------------


def _mint(user, **claims) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "campus_id": None,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        **claims,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def test_a_validly_signed_token_without_a_session_claim_is_refused(client, user_factory):
    # Tokens issued before this change have no `sid`; the browser simply
    # refreshes and gets a session-bound one.
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)
    assert client.get(ME, headers=_bearer(_mint(user))).status_code == 401


def test_a_validly_signed_token_for_an_unknown_or_dead_session_is_refused(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)
    assert client.get(ME, headers=_bearer(_mint(user, sid=str(uuid.uuid4())))).status_code == 401
    assert client.get(ME, headers=_bearer(_mint(user, sid="not-a-uuid"))).status_code == 401


def test_normal_expiry_still_applies(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    live = _login(client, user)
    claims = jwt.decode(live, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    # Same live session, but an exp in the past: signature and expiry are
    # still enforced exactly as before the session check was added.
    expired = _mint(user, sid=claims["sid"], exp=datetime.now(timezone.utc) - timedelta(seconds=1))
    assert client.get(ME, headers=_bearer(expired)).status_code == 401
    assert client.get(ME, headers=_bearer(live)).status_code == 200
    assert session_cookie(client)  # the refresh half of the session is untouched by all this
