"""Client-IP resolution behind a trusted reverse proxy (2026-09-03, audit C1).

Production sits behind Caddy; from inside the container every request's
TCP peer is the Docker bridge gateway. These tests wrap the real app in the
exact middleware `app/main.py` adds, with that gateway as the only trusted
proxy, and prove four things end to end through the real login endpoint:

1. a forwarded address from the trusted peer becomes the client IP;
2. the rate limiter buckets on that resolved IP, not on the peer;
3. the audit log records that resolved IP;
4. a forwarded header from an UNTRUSTED peer -- or a spoofed prefix in front
   of the proxy's own entry -- cannot change the client IP.
"""

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.config import Settings
from app.main import app
from app.models.audit_log import AuditLog

TRUSTED_PROXY = "172.16.1.1"
LOGIN = "/api/v1/auth/login"
LOGIN_LIMIT = 30  # app/api/v1/routers/auth.py::_login_rate_limit, unchanged


def _proxied_client(peer: str) -> TestClient:
    """The real app (dependency overrides from the `client` fixture still
    apply -- they live on the same FastAPI instance) behind the same
    ProxyHeadersMiddleware main.py wires, connecting from `peer`."""
    return TestClient(ProxyHeadersMiddleware(app, trusted_hosts=[TRUSTED_PROXY]), client=(peer, 54321))


def _fail_login(test_client: TestClient, email: str, forwarded: str | None = None):
    headers = {"X-Forwarded-For": forwarded} if forwarded is not None else {}
    return test_client.post(LOGIN, data={"username": email, "password": "wrong-password"}, headers=headers)


def _last_login_failed_ip(db_session, email: str) -> str | None:
    row = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "LOGIN_FAILED")
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .first()
    )
    assert row is not None, f"no LOGIN_FAILED audit row for {email}"
    return row.ip_address


def test_forwarded_ip_from_trusted_proxy_is_recorded_in_the_audit_log(client, db_session):
    with _proxied_client(TRUSTED_PROXY) as proxied:
        response = _fail_login(proxied, "nobody@example.com", forwarded="203.0.113.10")
    assert response.status_code == 401
    assert _last_login_failed_ip(db_session, "nobody@example.com") == "203.0.113.10"


def test_spoofed_prefix_before_the_proxys_entry_does_not_win(client, db_session):
    # What a client would send to impersonate someone: its own bogus
    # address, after which Caddy appends the real remote address. The
    # right-most non-proxy address is the truth.
    with _proxied_client(TRUSTED_PROXY) as proxied:
        _fail_login(proxied, "nobody@example.com", forwarded="10.0.0.9, 203.0.113.11")
    assert _last_login_failed_ip(db_session, "nobody@example.com") == "203.0.113.11"


def test_forwarded_header_from_an_untrusted_peer_is_ignored(client, db_session):
    # Same header, but the connection comes from something that is not the
    # proxy: the header is not believed and the raw peer is recorded.
    with _proxied_client("198.51.100.7") as direct:
        _fail_login(direct, "nobody@example.com", forwarded="203.0.113.12")
    assert _last_login_failed_ip(db_session, "nobody@example.com") == "198.51.100.7"


def test_rate_limiter_buckets_on_the_forwarded_ip_not_the_proxy(client):
    with _proxied_client(TRUSTED_PROXY) as proxied:
        first = [_fail_login(proxied, "nobody@example.com", forwarded="203.0.113.20") for _ in range(LOGIN_LIMIT + 1)]
        # 30 allowed, the 31st refused -- the configured value is unchanged.
        assert [r.status_code for r in first[:LOGIN_LIMIT]] == [401] * LOGIN_LIMIT
        assert first[LOGIN_LIMIT].status_code == 429

        # A DIFFERENT end user behind the SAME proxy is not affected. Before
        # the fix both keyed on the proxy address and this would be 429.
        other = _fail_login(proxied, "nobody@example.com", forwarded="203.0.113.21")
        assert other.status_code == 401


def test_rate_limiter_cannot_be_evaded_by_spoofing_from_an_untrusted_peer(client):
    # An attacker connecting directly (not via the proxy) rotating
    # X-Forwarded-For values must still share one bucket: the raw peer.
    with _proxied_client("198.51.100.8") as direct:
        responses = [
            _fail_login(direct, "nobody@example.com", forwarded=f"203.0.113.{i}") for i in range(LOGIN_LIMIT + 1)
        ]
    assert responses[LOGIN_LIMIT].status_code == 429


def test_without_trusted_proxies_the_app_adds_no_proxy_middleware():
    # Local dev: TRUSTED_PROXY_IPS is empty, uvicorn faces the browser
    # directly, the raw peer must be kept. `app` is built from the test
    # environment, where the setting is unset.
    assert not any(m.cls is ProxyHeadersMiddleware for m in app.user_middleware)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", []),
        ("172.16.1.1", ["172.16.1.1"]),
        (" 172.16.1.1 , 10.0.0.0/8 ", ["172.16.1.1", "10.0.0.0/8"]),
    ],
)
def test_trusted_proxy_ips_setting_parses_a_comma_list(raw, expected):
    settings = Settings(JWT_SECRET_KEY="test", TRUSTED_PROXY_IPS=raw)
    assert settings.trusted_proxy_ips_list == expected
