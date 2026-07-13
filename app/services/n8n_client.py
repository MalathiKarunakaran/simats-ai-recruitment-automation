"""Module 4/13: thin httpx wrapper around the (optional) n8n webhook base URL.

Mirrors app/services/ai_client.py's get_ai_client() / storage.py's
get_minio_client() "clean unconfigured signal, not a crash" pattern -- with
one deliberate split: get_n8n_client() is a *plain function*, not a FastAPI
dependency, because app/services/notifications.py calls it directly from 16
call sites that never go through a router's dependency graph (see that
module's docstring). get_n8n_client_or_503() below is the Depends()-shaped
variant for Module 4's single explicit, human-triggered distribution
endpoint, which fails loud like every other Phase 3 external integration
used via Depends(...).

No posting/delivery logic of any kind lives here or anywhere else in this
codebase -- n8n's existing workflow owns how a webhook call becomes an
email, a Telegram message, or a LinkedIn/Indeed/Naukri/FacultyPlus post.
"""

import httpx
from fastapi import HTTPException, status

from app.core.config import settings


class N8nClient:
    def __init__(self, base_url: str, timeout_seconds: float):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def post_webhook(self, path: str, payload: dict) -> dict | None:
        """POSTs JSON to {base_url}/{path}. Returns the parsed JSON response
        body on 2xx (or None if the body isn't JSON). Raises httpx.HTTPError
        on network failure / non-2xx -- callers decide whether that's fatal
        (Module 4: yes) or swallowed (notify(): no, see notifications.py)."""
        url = f"{self._base_url}/{path.lstrip('/')}"
        response = httpx.post(url, json=payload, timeout=self._timeout)
        response.raise_for_status()
        try:
            return response.json()
        except ValueError:
            return None


def get_n8n_client() -> N8nClient | None:
    """Plain function -- called directly by app/services/notifications.py.
    Returns None when N8N_BASE_URL is unset (the default in dev/test),
    letting notify() degrade to a FAILED row instead of crashing the
    caller's transaction."""
    if not settings.N8N_BASE_URL:
        return None
    return N8nClient(settings.N8N_BASE_URL, settings.N8N_TIMEOUT_SECONDS)


def get_n8n_client_or_503() -> N8nClient:
    """FastAPI dependency for Module 4's distribute endpoint -- same
    clean-503-on-unconfigured shape as ai_client.get_ai_client()."""
    client = get_n8n_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job-portal distribution is not configured (N8N_BASE_URL is not set)",
        )
    return client
