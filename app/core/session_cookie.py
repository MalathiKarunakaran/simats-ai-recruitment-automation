"""Audit M1 (2026-09-03): the refresh token lives in an HttpOnly cookie, never
in the response body and never in browser storage.

Cookie shape, and why each attribute is what it is:

- **HttpOnly** -- script cannot read it, so an XSS payload cannot lift the
  7-day session; it can only drive requests while the page is open.
- **Secure** in production -- never sent over plain HTTP. Off outside
  production because local dev serves http://localhost.
- **SameSite=Strict** -- the browser attaches it only to requests whose
  initiator is the same site. app.malathi.io -> api.malathi.io is same-site
  (one registrable domain), localhost:5173 -> localhost:8000 likewise, so
  the app's own fetches carry it and a cross-site page's never do.
- **Path=/api/v1/auth** -- only the auth endpoints ever see it. Every other
  API call is authenticated by the in-memory access JWT, so nothing else
  needs (or receives) the cookie.
- **No Domain attribute** -- host-only, so it is scoped to the API host and
  is not shared with sibling subdomains.

CSRF: SameSite=Strict is the first layer. `require_csrf_protection` is the
second, for the two endpoints that consume the cookie (refresh, logout):
the request must carry `X-Requested-With: XMLHttpRequest` -- a custom
header a cross-origin page can only send after a CORS preflight, which the
CORS allow-list refuses for unknown origins, and which an HTML form cannot
send at all -- and any `Origin`/`Referer`/`Sec-Fetch-Site` the browser
attaches must name an allowed origin. A classic double-submit token is not
an option here: the SPA's script runs on a different origin from the API
and cannot read a cookie the API sets, so the token could never make the
round trip.
"""

from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response, status

from app.core.config import settings

REFRESH_COOKIE_NAME = "simats_refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth"
CSRF_HEADER_NAME = "X-Requested-With"
CSRF_HEADER_VALUE = "XMLHttpRequest"


def _cookie_secure() -> bool:
    return settings.is_production


def set_refresh_cookie(response: Response, raw_refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        secure=_cookie_secure(),
        httponly=True,
        samesite="strict",
    )


def clear_refresh_cookie(response: Response) -> None:
    # Same path/flags as the set, or the browser keeps the original.
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        secure=_cookie_secure(),
        httponly=True,
        samesite="strict",
    )


def read_refresh_cookie(request: Request) -> str | None:
    value = request.cookies.get(REFRESH_COOKIE_NAME)
    return value or None


def _origin_of(url: str) -> str | None:
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def _allowed_origins(request: Request) -> set[str]:
    allowed = {origin.lower() for origin in settings.cors_allowed_origins_list}
    # The API's own origin (Swagger UI, same-host deployments). Behind the
    # proxy, scheme/host are the forwarded ones -- see app/main.py.
    own = _origin_of(str(request.base_url))
    if own:
        allowed.add(own)
    return allowed


def require_csrf_protection(request: Request) -> None:
    """FastAPI dependency for every endpoint that consumes the refresh cookie."""
    forbidden = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-site request refused")

    if request.headers.get(CSRF_HEADER_NAME, "").lower() != CSRF_HEADER_VALUE.lower():
        raise forbidden

    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise forbidden

    allowed = _allowed_origins(request)
    origin = request.headers.get("origin")
    if origin:
        if origin.lower() not in allowed:
            raise forbidden
        return
    referer = request.headers.get("referer")
    if referer:
        referer_origin = _origin_of(referer)
        if referer_origin is None or referer_origin not in allowed:
            raise forbidden
