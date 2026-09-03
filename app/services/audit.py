"""Audit logging helpers.

Deliberately a set of plain functions called explicitly from mutating router
handlers (in the *same* DB session/transaction as the mutation), not ASGI
middleware. Middleware that writes after call_next() fights the
sync-session-per-request lifecycle -- the session may already be closed by
the time a response is produced. Calling `db.add(...)` here and letting the
router's own `db.commit()` cover both the mutation and the audit row keeps
them atomic with a couple of extra lines per endpoint.
"""

import datetime as _dt
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User
from app.core.client_ip import client_ip


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (uuid.UUID, _dt.datetime, _dt.date)):
        return str(value)
    return value


def _request_meta(request: Request | None) -> dict[str, Any]:
    if request is None:
        return {}
    return {
        # Resolved through the trusted-proxy chain, never the raw peer --
        # see app/core/client_ip.py.
        "ip_address": client_ip(request),
        "user_agent": request.headers.get("user-agent"),
        "http_method": request.method,
        "http_path": request.url.path,
    }


def log_event(
    db: Session,
    *,
    actor: User | None,
    action: str,
    campus_context_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    before_state: dict | None = None,
    after_state: dict | None = None,
    request: Request | None = None,
    status_code: int | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_role_snapshot=actor.role.value if actor else None,
        campus_context_id=campus_context_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_state=_json_safe(before_state) if before_state else None,
        after_state=_json_safe(after_state) if after_state else None,
        status_code=status_code,
        **_request_meta(request),
    )
    db.add(entry)
    return entry


def log_create(
    db: Session,
    *,
    actor: User,
    entity_type: str,
    entity: Any,
    campus_context_id: uuid.UUID | None,
    after_state: dict,
    request: Request | None = None,
) -> AuditLog:
    return log_event(
        db,
        actor=actor,
        action="CREATE",
        campus_context_id=campus_context_id,
        entity_type=entity_type,
        entity_id=getattr(entity, "id", None),
        after_state=after_state,
        request=request,
    )


def log_update(
    db: Session,
    *,
    actor: User,
    entity_type: str,
    entity: Any,
    campus_context_id: uuid.UUID | None,
    before_state: dict,
    after_state: dict,
    request: Request | None = None,
) -> AuditLog:
    return log_event(
        db,
        actor=actor,
        action="UPDATE",
        campus_context_id=campus_context_id,
        entity_type=entity_type,
        entity_id=getattr(entity, "id", None),
        before_state=before_state,
        after_state=after_state,
        request=request,
    )


def log_delete(
    db: Session,
    *,
    actor: User,
    entity_type: str,
    entity: Any,
    campus_context_id: uuid.UUID | None,
    before_state: dict,
    request: Request | None = None,
) -> AuditLog:
    return log_event(
        db,
        actor=actor,
        action="DELETE",
        campus_context_id=campus_context_id,
        entity_type=entity_type,
        entity_id=getattr(entity, "id", None),
        before_state=before_state,
        request=request,
    )


def log_auth_event(
    db: Session,
    *,
    actor: User | None,
    action: str,
    request: Request | None = None,
    status_code: int | None = None,
) -> AuditLog:
    return log_event(
        db,
        actor=actor,
        action=action,
        campus_context_id=actor.campus_id if actor else None,
        request=request,
        status_code=status_code,
    )
