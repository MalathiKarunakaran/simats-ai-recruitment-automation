import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import NotificationChannelEnum, NotificationStatusEnum


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipient_user_id: uuid.UUID | None
    recipient_email: str | None
    campus_context_id: uuid.UUID | None
    notification_type: str
    channel: NotificationChannelEnum
    subject: str
    body: str
    status: NotificationStatusEnum
    related_entity_type: str | None
    related_entity_id: uuid.UUID | None
    sent_at: datetime | None
    error_message: str | None
    created_at: datetime
