"""The one place the application reads "which IP is this request from".

`request.client.host` is whatever the ASGI server put in `scope["client"]`.
Behind a reverse proxy that is the PROXY's address for every request --
in production, Caddy on the VPS host reaches the container through the
Docker bridge, so every audit row used to say 172.16.1.1 and every
per-IP rate limit was one shared bucket for the whole institution
(2026-09-03 audit, finding C1).

The fix lives in `app/main.py`: uvicorn's `ProxyHeadersMiddleware` rewrites
`scope["client"]` from `X-Forwarded-For`, but ONLY when the immediate peer
is one of `settings.TRUSTED_PROXY_IPS`, and it takes the right-most address
in the chain that is not itself a trusted proxy. A client cannot spoof
that: whatever it puts in the header, the proxy appends the real peer
address after it, and the walk from the right stops there.

Everything that needs a client IP -- the rate limiter, the audit log, the
refresh-token row -- must call `client_ip` and must NOT parse
`X-Forwarded-For` themselves. Parsing it in application code is exactly
how spoofable "trust the first address" bugs are written.
"""

from starlette.requests import Request


def client_ip(request: Request | None) -> str | None:
    """The resolved client address, or None when there is no connection
    (background/synthetic requests)."""
    if request is None or request.client is None:
        return None
    return request.client.host
