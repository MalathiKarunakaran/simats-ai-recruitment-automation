"""Phase 7: minimal security-headers middleware. Hand-rolled rather than a
new dependency -- it's four static headers, not worth a library."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        # Only meaningful (and only added) over HTTPS -- a no-op header over
        # plain HTTP local dev, correct once a reverse proxy terminates TLS
        # in front of this app and forwards X-Forwarded-Proto.
        is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        if is_https:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
