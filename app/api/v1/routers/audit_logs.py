import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_db, require_permission
from app.models.audit_log import AuditLog
from app.models.enums import PermissionEnum
from app.models.user import User
from app.schemas.audit_log import AuditLogRead
from app.schemas.common import PaginatedResponse
from app.services.reporting import validate_date_range

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


@router.get("", response_model=PaginatedResponse[AuditLogRead])
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    # Phase H (glowing-zooming-hamming.md) -- entity_id filter, added for the
    # Sanctioned Strength drawer's Audit Log tab (one entity's full history,
    # not just its type). Additive: combines by AND with entity_type exactly
    # like every other filter on this endpoint, so passing both narrows to
    # "this specific entity of this specific type" -- no existing caller
    # passes it, so omitting it is a no-op.
    entity_id: uuid.UUID | None = None,
    campus_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.ACTIVITY_LOG)),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[AuditLogRead]:
    validate_date_range(start_date, end_date)
    query = db.query(AuditLog)

    if not scope.is_global:
        # CAMPUS_HOD is hard-pinned to their own campus context regardless of
        # any campus_id filter they pass.
        query = query.filter(AuditLog.campus_context_id == scope.campus_id)
    elif campus_id is not None:
        query = query.filter(AuditLog.campus_context_id == campus_id)

    if actor_user_id is not None:
        query = query.filter(AuditLog.actor_user_id == actor_user_id)
    if entity_type is not None:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(AuditLog.entity_id == entity_id)
    if start_date is not None:
        query = query.filter(AuditLog.created_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc))
    if end_date is not None:
        # +1 day so end_date is inclusive of the whole day, not just its
        # midnight instant -- same fix reporting.py's _optional_date_range
        # already applies for report date-range filters.
        query = query.filter(
            AuditLog.created_at < datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        )

    total = query.count()
    rows = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{audit_log_id}", response_model=AuditLogRead)
def get_audit_log(
    audit_log_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.ACTIVITY_LOG)),
    scope: CampusScope = Depends(get_campus_scope),
) -> AuditLog:
    entry = db.get(AuditLog, audit_log_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not scope.is_global and entry.campus_context_id != scope.campus_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return entry
