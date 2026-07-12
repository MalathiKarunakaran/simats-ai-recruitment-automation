import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_current_active_user, get_db
from app.models.enums import UserRoleEnum
from app.models.notification import Notification
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.notification import NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _visible_query(db: Session, current_user: User, scope: CampusScope):
    query = db.query(Notification)
    if scope.is_global:
        return query
    return query.filter(
        (Notification.recipient_user_id == current_user.id)
        | (Notification.campus_context_id == scope.campus_id)
    )


@router.get("", response_model=PaginatedResponse[NotificationRead])
def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[NotificationRead]:
    query = _visible_query(db, current_user, scope)
    total = query.count()
    rows = query.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{notification_id}", response_model=NotificationRead)
def get_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> Notification:
    notification = db.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not scope.is_global and notification.recipient_user_id != current_user.id and notification.campus_context_id != scope.campus_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return notification
