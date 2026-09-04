"""Phase 7: minimal security-headers middleware. Hand-rolled rather than a
new dependency -- it's a handful of static headers, not worth a library.

Audit M1 (2026-09-03) adds a Content-Security-Policy. This API serves JSON
(and file downloads), never a page that runs script, so the policy is the
strictest possible: nothing may load, nothing may frame it. The SPA's own
policy is a different document served by a different host -- see
frontend/nginx.conf. The interactive docs are the one exception: Swagger
UI and ReDoc are HTML that pulls their bundle from a CDN with inline
bootstrap script, so those paths are left without a CSP rather than given
a permissive one that would be a false statement about the rest of the API.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
_DOCS_PATH_PREFIXES = ("/docs", "/redoc")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if not request.url.path.startswith(_DOCS_PATH_PREFIXES):
            response.headers["Content-Security-Policy"] = API_CONTENT_SECURITY_POLICY
        # Only meaningful (and only added) over HTTPS -- a no-op header over
        # plain HTTP local dev, correct once a reverse proxy terminates TLS
        # in front of this app and forwards X-Forwarded-Proto.
        is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        if is_https:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
