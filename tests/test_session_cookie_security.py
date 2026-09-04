"""Audit M1 (2026-09-03): refresh token in an HttpOnly cookie, CSRF
protection on the endpoints that consume it, and a Content-Security-Policy
on the API. See app/core/session_cookie.py and app/core/security_headers.py.
"""

from http.cookies import SimpleCookie

from app.core.config import settings
from app.core.security_headers import API_CONTENT_SECURITY_POLICY
from app.core.session_cookie import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from app.models.enums import UserRoleEnum

from tests.conftest import CSRF_HEADERS, auth_headers, refresh_session, session_cookie


def _login(client, user):
    response = client.post(
        "/api/v1/auth/login", data={"username": user.email, "password": user.plain_password}
    )
    assert response.status_code == 200, response.text
    return response


def _refresh_cookie_from(response) -> SimpleCookie:
    jar = SimpleCookie()
    for header in response.headers.get_list("set-cookie"):
        jar.load(header)
    assert REFRESH_COOKIE_NAME in jar, response.headers
    return jar


# --- the cookie itself -------------------------------------------------------


def test_login_sets_httponly_samesite_strict_cookie_and_keeps_token_out_of_body(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    response = _login(client, user)

    assert "refresh_token" not in response.json()
    morsel = _refresh_cookie_from(response)[REFRESH_COOKIE_NAME]
    assert morsel.value
    assert morsel["httponly"]
    assert morsel["samesite"].lower() == "strict"
    assert morsel["path"] == REFRESH_COOKIE_PATH
    assert int(morsel["max-age"]) == settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    # Host-only: no Domain attribute, so sibling subdomains never receive it.
    assert not morsel["domain"]


def test_refresh_cookie_is_not_secure_outside_production_but_is_in_production(
    client, user_factory, monkeypatch
):
    user = user_factory(UserRoleEnum.HR_ADMIN)

    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    dev_morsel = _refresh_cookie_from(_login(client, user))[REFRESH_COOKIE_NAME]
    assert not dev_morsel["secure"]

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    prod_morsel = _refresh_cookie_from(_login(client, user))[REFRESH_COOKIE_NAME]
    assert prod_morsel["secure"]
    assert prod_morsel["httponly"]
    assert prod_morsel["samesite"].lower() == "strict"


def test_otp_verify_sets_the_same_cookie(client, user_factory, login_otp_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    code = login_otp_factory(user)

    response = client.post("/api/v1/auth/otp-verify", json={"email": user.email, "code": code})
    assert response.status_code == 200, response.text
    assert "refresh_token" not in response.json()
    assert _refresh_cookie_from(response)[REFRESH_COOKIE_NAME]["httponly"]


# --- refresh / logout through the cookie -------------------------------------


def test_refresh_rotates_the_cookie_and_revokes_the_presented_token(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)
    first = session_cookie(client)

    refreshed = refresh_session(client)
    assert refreshed.status_code == 200, refreshed.text
    assert "refresh_token" not in refreshed.json()
    second = _refresh_cookie_from(refreshed)[REFRESH_COOKIE_NAME].value
    assert second and second != first

    # The rotated-out token is dead; the new one works.
    assert refresh_session(client, first).status_code == 401
    assert refresh_session(client, second).status_code == 200


def test_refresh_without_cookie_is_401(client):
    client.cookies.clear()
    response = client.post("/api/v1/auth/refresh", headers=CSRF_HEADERS)
    assert response.status_code == 401


def test_refresh_with_stale_cookie_clears_it(client, user_factory):
    response = refresh_session(client, "not-a-real-token")
    assert response.status_code == 401
    morsel = _refresh_cookie_from(response)[REFRESH_COOKIE_NAME]
    assert morsel.value == "" or int(morsel.get("max-age", "0") or 0) == 0


def test_logout_revokes_the_cookie_token_and_clears_the_cookie(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = _login(client, user)
    raw_refresh = session_cookie(client)

    response = client.post(
        "/api/v1/auth/logout",
        headers={**CSRF_HEADERS, "Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert response.status_code == 204, response.text
    morsel = _refresh_cookie_from(response)[REFRESH_COOKIE_NAME]
    assert morsel.value == "" or int(morsel.get("max-age", "0") or 0) == 0
    assert refresh_session(client, raw_refresh).status_code == 401


def test_force_logout_and_password_change_still_kill_the_cookie_session(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    _login(client, target)
    before_force_logout = session_cookie(client)
    assert (
        client.post(f"/api/v1/users/{target.id}/force-logout", headers=auth_headers(client, admin)).status_code
        == 204
    )
    assert refresh_session(client, before_force_logout).status_code == 401

    _login(client, target)
    before_reset = session_cookie(client)
    assert (
        client.post(
            f"/api/v1/users/{target.id}/reset-password",
            headers=auth_headers(client, admin),
            json={"password": "BrandNewPass123!"},
        ).status_code
        == 200
    )
    assert refresh_session(client, before_reset).status_code == 401


# --- CSRF ----------------------------------------------------------------------


def test_refresh_without_the_custom_header_is_refused(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)

    response = client.post("/api/v1/auth/refresh")  # cookie present, header absent
    assert response.status_code == 403
    assert "Cross-site" in response.json()["detail"]


def test_logout_without_the_custom_header_is_refused(client, user_factory):
    user = user_factory(UserRoleEnum.HR_ADMIN)
    login = _login(client, user)

    response = client.post(
        "/api/v1/auth/logout", headers={"Authorization": f"Bearer {login.json()['access_token']}"}
    )
    assert response.status_code == 403


def test_refresh_from_a_foreign_origin_is_refused(client, user_factory, monkeypatch):
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://app.example.edu")
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)

    foreign = client.post(
        "/api/v1/auth/refresh", headers={**CSRF_HEADERS, "Origin": "https://evil.example.com"}
    )
    assert foreign.status_code == 403

    allowed = client.post(
        "/api/v1/auth/refresh", headers={**CSRF_HEADERS, "Origin": "https://app.example.edu"}
    )
    assert allowed.status_code == 200, allowed.text


def test_refresh_from_a_foreign_referer_or_cross_site_fetch_is_refused(client, user_factory, monkeypatch):
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://app.example.edu")
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)

    by_referer = client.post(
        "/api/v1/auth/refresh", headers={**CSRF_HEADERS, "Referer": "https://evil.example.com/page"}
    )
    assert by_referer.status_code == 403

    by_fetch_metadata = client.post(
        "/api/v1/auth/refresh",
        headers={**CSRF_HEADERS, "Origin": "https://app.example.edu", "Sec-Fetch-Site": "cross-site"},
    )
    assert by_fetch_metadata.status_code == 403

    same_site = client.post(
        "/api/v1/auth/refresh",
        headers={**CSRF_HEADERS, "Origin": "https://app.example.edu", "Sec-Fetch-Site": "same-site"},
    )
    assert same_site.status_code == 200, same_site.text


def test_the_apis_own_origin_is_always_allowed(client, user_factory):
    # Swagger UI on the API host itself sends Origin: http://testserver.
    user = user_factory(UserRoleEnum.HR_ADMIN)
    _login(client, user)
    response = client.post("/api/v1/auth/refresh", headers={**CSRF_HEADERS, "Origin": "http://testserver"})
    assert response.status_code == 200, response.text


# --- CSP -------------------------------------------------------------------------


def test_api_responses_carry_a_locked_down_csp(client):
    response = client.get("/health")
    assert response.headers["content-security-policy"] == API_CONTENT_SECURITY_POLICY
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]

    unauthenticated_api = client.get("/api/v1/auth/me")
    assert unauthenticated_api.status_code == 401
    assert unauthenticated_api.headers["content-security-policy"] == API_CONTENT_SECURITY_POLICY


def test_interactive_docs_are_the_only_paths_without_the_api_csp(client):
    for path in ("/docs", "/redoc"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "content-security-policy" not in response.headers, path
