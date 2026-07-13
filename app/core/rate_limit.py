"""Phase 7: minimal in-memory rate limiter for brute-force/enumeration-prone
endpoints (login, password-reset-request). No new dependency -- a sliding
window over a handful of endpoints doesn't need slowapi/Redis.

Caveat, documented rather than solved this phase: state lives in a plain
module-level dict, so this only throttles within a single process. A
multi-worker/multi-instance deployment would need a shared store (e.g.
Redis) for this to hold across processes -- fine for the single-VPS,
single-worker deployment target in this phase's scope.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
