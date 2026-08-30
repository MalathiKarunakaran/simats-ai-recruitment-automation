"""Staff-facing QR management for the public vacancy-request intake
(2026-08-30).

Two things these pin that are easy to get wrong:

1. **Route ordering.** These live on a separate `qr_router` registered BEFORE
   the main vacancy-requests router. Appended to the main router instead they
   would sit after `GET /vacancy-requests/{vacancy_request_id}`, and FastAPI
   matches in declaration order -- "qr" would be parsed as a UUID path param
   and 422 before reaching the handler.

2. **The URL is configuration-derived, never hard-coded.** A QR code printed
   and stuck on a noticeboard is the least correctable artefact this system
   produces, so the target must follow the deployment's configured frontend
   base rather than localhost or the careers domain.
"""

from app.core.config import settings
from app.models.enums import UserRoleEnum
from app.services import vacancy_request_intake

from tests.conftest import auth_headers

INFO = "/api/v1/vacancy-requests/qr/info"
CODE = "/api/v1/vacancy-requests/qr/code.png"


def test_info_returns_the_public_form_url(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.get(INFO, headers=auth_headers(client, hr_admin))

    assert response.status_code == 200
    url = response.json()["url"]
    assert url.endswith("/vacancy-request/public")
    # Whatever the base is, it must be an absolute URL -- a relative path in a
    # QR code is meaningless once scanned by a phone camera.
    assert url.startswith("http://") or url.startswith("https://")


def test_url_follows_configured_base_not_the_careers_domain(client, user_factory):
    """PUBLIC_APPLY_BASE_URL is the candidate careers site. Pointing staff
    there would send them to a different application entirely."""
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    url = client.get(INFO, headers=auth_headers(client, hr_admin)).json()["url"]

    assert settings.PUBLIC_APPLY_BASE_URL not in url


def test_url_is_not_hard_coded_to_localhost(monkeypatch, client, user_factory):
    monkeypatch.setattr(settings, "PUBLIC_APP_BASE_URL", "https://app.malathi.io", raising=False)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    url = client.get(INFO, headers=auth_headers(client, hr_admin)).json()["url"]

    assert url == "https://app.malathi.io/vacancy-request/public"


def test_base_url_falls_back_to_the_first_cors_origin(monkeypatch):
    """In every real deployment the frontend origin IS the first CORS origin,
    so an unconfigured PUBLIC_APP_BASE_URL still produces a correct QR rather
    than a broken one."""
    monkeypatch.setattr(settings, "PUBLIC_APP_BASE_URL", "", raising=False)
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://app.example.edu,https://staging.example.edu")

    assert vacancy_request_intake.build_public_request_url() == "https://app.example.edu/vacancy-request/public"


def test_base_url_strips_a_trailing_slash(monkeypatch):
    # Otherwise the URL doubles up as "https://host//vacancy-request/public".
    monkeypatch.setattr(settings, "PUBLIC_APP_BASE_URL", "https://app.example.edu/", raising=False)

    assert vacancy_request_intake.build_public_request_url() == "https://app.example.edu/vacancy-request/public"


def test_code_returns_a_png(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.get(CODE, headers=auth_headers(client, hr_admin))

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    # PNG magic number -- proves an actual image came back, not an error page
    # rendered with a 200.
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "attachment" in response.headers["content-disposition"]


def test_qr_paths_are_not_swallowed_by_the_id_route(client, user_factory):
    """The routing-order regression: if qr_router were registered after the
    main router, "qr" would be parsed as a vacancy_request_id and this would
    be a 422, not a 200."""
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    assert client.get(INFO, headers=auth_headers(client, hr_admin)).status_code == 200
    assert client.get(CODE, headers=auth_headers(client, hr_admin)).status_code == 200


def test_qr_endpoints_require_authentication(client):
    """The FORM is public; generating and printing the code is an
    administrative action and is not."""
    assert client.get(INFO).status_code == 401
    assert client.get(CODE).status_code == 401


def test_candidates_cannot_reach_the_qr_endpoints(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    assert client.get(INFO, headers=auth_headers(client, candidate)).status_code == 403
