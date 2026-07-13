"""Phase 7: repeatable concurrent-load smoke test against a running dev
server. Uses httpx (already a project dependency) -- no new load-testing
framework. Not part of pytest, run manually/as an ops script, same
precedent as app/db/seed.py.

Simulates multiple campuses' staff hitting representative read endpoints
concurrently: vacancy list, application pipeline list, dashboard KPIs, and
a Module 12 report. Requires the dev server running (see README) and seed
data loaded (python -m app.db.seed) -- uses the real seeded HOD/HR Admin
accounts across SSE/SCAD (the campuses with Phase 2/3 seed scenarios).

Each of the 5 seeded accounts logs in exactly once up front (not once per
simulated worker) -- otherwise a high --concurrency would just be hammering
POST /auth/login itself and tripping Phase 7's own login rate limiter
instead of exercising the endpoints under test. Concurrent *workers* then
share those 5 tokens round-robin, which is also the more realistic shape:
a handful of real staff accounts, each with many concurrent in-flight
requests from an already-authenticated session.

Usage:
    venv/Scripts/python.exe scripts/load_test.py [--base-url URL]
        [--concurrency N] [--requests-per-worker N]
"""

import argparse
import asyncio
import os
import random
import time
from dataclasses import dataclass, field

import httpx

_SEED_USERS = [
    ("hr.admin@example.com", "GLOBAL"),
    ("associate.dean@example.com", "GLOBAL"),
    ("hod.sse@example.com", "SSE"),
    ("hod.scad@example.com", "SCAD"),
    ("recruitment.officer.sse@example.com", "SSE"),
]

_ENDPOINTS = [
    ("GET", "/api/v1/vacancy-requests"),
    ("GET", "/api/v1/applications"),
    ("GET", "/api/v1/dashboard/kpis"),
    ("GET", "/api/v1/reports/recruitment-funnel"),
]


@dataclass
class EndpointStats:
    latencies_ms: list[float] = field(default_factory=list)
    errors: int = 0
    total: int = 0


async def _login(client: httpx.AsyncClient, base_url: str, email: str, password: str) -> str:
    response = await client.post(
        f"{base_url}/api/v1/auth/login", data={"username": email, "password": password}
    )
    response.raise_for_status()
    return response.json()["access_token"]


async def _worker(
    base_url: str,
    token: str,
    requests_per_worker: int,
    stats: dict[str, EndpointStats],
    stats_lock: asyncio.Lock,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for _ in range(requests_per_worker):
            shuffled = list(_ENDPOINTS)
            random.shuffle(shuffled)
            for method, path in shuffled:
                start = time.monotonic()
                try:
                    response = await client.request(method, f"{base_url}{path}", headers=headers)
                    elapsed_ms = (time.monotonic() - start) * 1000
                    is_error = response.status_code >= 400
                except httpx.HTTPError:
                    elapsed_ms = (time.monotonic() - start) * 1000
                    is_error = True

                async with stats_lock:
                    entry = stats[path]
                    entry.latencies_ms.append(elapsed_ms)
                    entry.total += 1
                    if is_error:
                        entry.errors += 1


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(int(len(ordered) * pct), len(ordered) - 1)
    return ordered[index]


async def run(base_url: str, concurrency: int, requests_per_worker: int, password: str) -> None:
    async with httpx.AsyncClient(timeout=30.0) as login_client:
        tokens = []
        for email, _campus in _SEED_USERS:
            tokens.append(await _login(login_client, base_url, email, password))

    stats: dict[str, EndpointStats] = {path: EndpointStats() for _, path in _ENDPOINTS}
    stats_lock = asyncio.Lock()

    tasks = [
        _worker(base_url, tokens[i % len(tokens)], requests_per_worker, stats, stats_lock)
        for i in range(concurrency)
    ]

    start = time.monotonic()
    await asyncio.gather(*tasks)
    total_elapsed = time.monotonic() - start

    print(f"\n=== Load test: {concurrency} concurrent workers x {requests_per_worker} requests/endpoint, "
          f"sharing {len(tokens)} pre-authenticated seeded accounts ===")
    print(f"Total wall time: {total_elapsed:.2f}s\n")
    print(f"{'Endpoint':<35} {'Reqs':>6} {'Errors':>7} {'Min':>9} {'p50':>9} {'p95':>9} {'p99':>9} {'Max':>9}")
    for _, path in _ENDPOINTS:
        entry = stats[path]
        latencies = entry.latencies_ms
        if not latencies:
            print(f"{path:<35} (no data)")
            continue
        print(
            f"{path:<35} {entry.total:>6} {entry.errors:>7} "
            f"{min(latencies):>7.1f}ms {_percentile(latencies, 0.50):>7.1f}ms "
            f"{_percentile(latencies, 0.95):>7.1f}ms {_percentile(latencies, 0.99):>7.1f}ms "
            f"{max(latencies):>7.1f}ms"
        )

    total_requests = sum(e.total for e in stats.values())
    total_errors = sum(e.errors for e in stats.values())
    if total_requests:
        print(f"\nTotal requests: {total_requests}, total errors: {total_errors} "
              f"({100 * total_errors / total_requests:.1f}% error rate)")
        print(f"Throughput: {total_requests / total_elapsed:.1f} req/s")
    else:
        print("\nNo requests completed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--requests-per-worker", type=int, default=10)
    parser.add_argument(
        "--password",
        default=os.environ.get("SEED_SAMPLE_USER_PASSWORD", "DevPass123!"),
        help="Shared seeded sample-user password (defaults to SEED_SAMPLE_USER_PASSWORD env var)",
    )
    args = parser.parse_args()

    asyncio.run(run(args.base_url, args.concurrency, args.requests_per_worker, args.password))


if __name__ == "__main__":
    main()
