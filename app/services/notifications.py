"""Module 13: Notification Agent.

Full interface (Notification rows, trigger points wired into every Phase 2
workflow transition) but delivery is a log-only stub -- same pattern as
Phase 1's password-reset-email stub. Real Gmail/Telegram delivery via n8n is
Phase 6 per the master spec's own phase breakdown.
"""

import uuid
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.enums import NotificationChannelEnum, NotificationStatusEnum, SINGLE_CAMPUS_SCOPE_ROLES, UserRoleEnum
from app.models.notification import Notification
from app.models.user import User


def notify(
    db: Session,
    *,
    recipient_user: User | None = None,
    recipient_email: str | None = None,
    notification_type: str,
    subject: str,
    body: str,
    channel: NotificationChannelEnum = NotificationChannelEnum.EMAIL,
    campus_context_id: uuid.UUID | None = None,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    request: Request | None = None,
) -> Notification:
    if recipient_user is None and not recipient_email:
        raise ValueError("notify() requires recipient_user or recipient_email")

    notification = Notification(
        recipient_user_id=recipient_user.id if recipient_user else None,
        recipient_email=recipient_email,
        campus_context_id=campus_context_id or (recipient_user.campus_id if recipient_user else None),
        notification_type=notification_type,
        channel=channel,
        subject=subject,
        body=body,
        status=NotificationStatusEnum.SENT,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        sent_at=datetime.now(timezone.utc),
    )
    db.add(notification)
    db.flush()

    recipient_label = recipient_email or (recipient_user.email if recipient_user else "unknown")
    print(f"[notification-stub] {channel.value} -> {recipient_label}: {subject}")
    return notification


def notify_role(
    db: Session,
    *,
    roles: set[UserRoleEnum],
    campus_id: uuid.UUID | None = None,
    notification_type: str,
    subject: str,
    body: str,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    request: Request | None = None,
) -> list[Notification]:
    """Fans out to every active User whose role is in `roles`. For
    single-campus-scoped roles (CAMPUS_HOD/RECRUITMENT_OFFICER/
    INTERVIEW_PANEL_MEMBER), only users at `campus_id` are notified when
    `campus_id` is given; global-scope roles are notified regardless."""
    candidates = db.query(User).filter(User.role.in_(roles), User.is_active.is_(True)).all()

    notifications = []
    for user in candidates:
        if campus_id is not None and user.role in SINGLE_CAMPUS_SCOPE_ROLES and user.campus_id != campus_id:
            continue
        notifications.append(
            notify(
                db,
                recipient_user=user,
                notification_type=notification_type,
                subject=subject,
                body=body,
                campus_context_id=campus_id or user.campus_id,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                request=request,
            )
        )
    return notifications
