import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import NotificationChannelEnum, NotificationStatusEnum


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL", name="has_recipient"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # Staff/panel recipients are Users; candidates aren't Users (no portal
    # yet, Module 5 is deferred) so they're addressed by raw email instead.
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    recipient_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Mirrors AuditLog.campus_context_id -- drives campus-scoped listing.
    campus_context_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Plain string, not a DB enum -- this catalog of "what happened" grows
    # with every later phase, same reasoning as AuditLog.action.
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Small, stable set of transport mechanisms -- a real enum, unlike
    # notification_type above.
    channel: Mapped[NotificationChannelEnum] = mapped_column(
        Enum(NotificationChannelEnum, name="notification_channel_enum"),
        nullable=False,
        default=NotificationChannelEnum.EMAIL,
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[NotificationStatusEnum] = mapped_column(
        Enum(NotificationStatusEnum, name="notification_status_enum"),
        nullable=False,
        default=NotificationStatusEnum.PENDING,
    )

    # Generic FK-less reference, mirrors AuditLog.entity_type/entity_id.
    related_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Unused by the Phase 3 stub (which always succeeds) -- reserved for
    # Phase 6 when real Gmail/Telegram delivery can actually fail.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    recipient_user: Mapped["User"] = relationship()
    campus_context: Mapped["Campus"] = relationship()

    def __repr__(self) -> str:
        return f"<Notification {self.notification_type} -> {self.recipient_user_id or self.recipient_email}>"
