"""Minimal in-memory sliding-window rate limiter for brute-force/enumeration-prone
endpoints (login, OTP, password-reset-request, the public QR form). No new
dependency -- a sliding window over a handful of endpoints doesn't need
slowapi/Redis.

Keyed on the CLIENT IP as resolved by `app.core.client_ip.client_ip`, i.e.
the address uvicorn's ProxyHeadersMiddleware put in the scope after
honouring X-Forwarded-For from a trusted proxy only. Until 2026-09-03 this
read the raw TCP peer, which behind Caddy was the Docker bridge gateway for
every request -- so every limiter here was ONE bucket shared by every user
of the system, and 30 failed logins from anyone locked everyone out.

KNOWN LIMITATION, deliberately not papered over: the buckets are a
module-level dict, so each uvicorn worker process has its own. With
`UVICORN_WORKERS=4` (the production default) a client can make up to
4 x max_requests per window before every worker has refused it, and a
worker restart forgets everything. The configured values below are the
per-process ceilings, not a global guarantee. Sharing state (Postgres or
Redis) is the follow-up if a genuinely global limit is ever required.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.core.client_ip import client_ip

_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    # Never parse X-Forwarded-For here -- see app/core/client_ip.py.
    return client_ip(request) or "unknown"


class RateLimiter:
    def __init__(self, *, max_requests: int, window_seconds: float, name: str):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.name = name

    def __call__(self, request: Request) -> None:
        key = (self.name, _client_ip(request))
        now = time.monotonic()
        window_start = now - self.window_seconds
        bucket = _buckets[key]
        while bucket and bucket[0] < window_start:
            bucket.pop(0)
        if len(bucket) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, please try again later",
            )
        bucket.append(now)


def reset_all() -> None:
    """Test-only helper: clears every bucket. TestClient requests all share
    the same synthetic client IP, so tests must reset state between runs."""
    _buckets.clear()
