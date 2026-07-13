"""Module 13: Notification Agent.

Delivery is real as of Phase 6: every notify()/notify_role() call attempts
an n8n webhook POST carrying `channel` in the payload -- n8n's own existing
flow (not this codebase) decides Gmail vs. Telegram vs. WhatsApp/SMS
delivery from that field, satisfying "reuse existing Gmail/Telegram
integrations" without this codebase touching those APIs directly.

get_n8n_client() is called directly here (not injected via Depends) because
notify()/notify_role() are called from 16 sites across 4 service files
(vacancy_workflow.py, pipeline.py, joining.py, interviews.py), never from a
router's dependency graph -- see app/services/n8n_client.py's docstring.

Delivery failure -- including n8n being unconfigured -- marks the row
FAILED with error_message set and NEVER raises. Notifications are a
best-effort side effect of a workflow transition; a broken webhook must
never roll back the vacancy/application/offer/joining transaction that
triggered it.
"""

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import Request
from sqlalchemy.orm import Session

from app.models.enums import NotificationChannelEnum, NotificationStatusEnum, SINGLE_CAMPUS_SCOPE_ROLES, UserRoleEnum
from app.models.notification import Notification
from app.models.user import User
from app.services.n8n_client import get_n8n_client


def _deliver(notification: Notification) -> tuple[NotificationStatusEnum, str | None]:
    """Never raises. Returns (status, error_message)."""
    client = get_n8n_client()
    if client is None:
        return NotificationStatusEnum.FAILED, "n8n not configured"

    payload = {
        "notification_type": notification.notification_type,
        "channel": notification.channel.value,
        "recipient_email": notification.recipient_email,
        "recipient_user_id": str(notification.recipient_user_id) if notification.recipient_user_id else None,
        "subject": notification.subject,
        "body": notification.body,
        "related_entity_type": notification.related_entity_type,
        "related_entity_id": str(notification.related_entity_id) if notification.related_entity_id else None,
    }
    try:
        client.post_webhook("notify", payload)
    except httpx.HTTPError as exc:
        return NotificationStatusEnum.FAILED, f"n8n webhook call failed: {exc}"
    return NotificationStatusEnum.SENT, None


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
        status=NotificationStatusEnum.PENDING,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )
    db.add(notification)
    db.flush()

    delivery_status, error_message = _deliver(notification)
    notification.status = delivery_status
    notification.error_message = error_message
    if delivery_status == NotificationStatusEnum.SENT:
        notification.sent_at = datetime.now(timezone.utc)

    recipient_label = recipient_email or (recipient_user.email if recipient_user else "unknown")
    print(f"[notification] {channel.value} -> {recipient_label}: {subject} ({delivery_status.value})")
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
