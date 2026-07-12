import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_db, require_roles
from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.audit_log import AuditLogRead
from app.schemas.common import PaginatedResponse

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

_READ_ROLES = (
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
    UserRoleEnum.CAMPUS_HOD,
)


@router.get("", response_model=PaginatedResponse[AuditLogRead])
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    campus_id: uuid.UUID | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_READ_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[AuditLogRead]:
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
    if start_date is not None:
        query = query.filter(AuditLog.created_at >= start_date)
    if end_date is not None:
        query = query.filter(AuditLog.created_at <= end_date)

    total = query.count()
    rows = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{audit_log_id}", response_model=AuditLogRead)
def get_audit_log(
    audit_log_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_READ_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> AuditLog:
    entry = db.get(AuditLog, audit_log_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not scope.is_global and entry.campus_context_id != scope.campus_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return entry
