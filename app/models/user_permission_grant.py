import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import PermissionEnum


class UserPermissionGrant(Base):
    """Presence of a row means user_id has `permission` -- the generalized,
    any-role successor to CoordinatorCapabilityGrant (see that model's own
    docstring). Deliberately no "revoked_at" soft-delete column: a revoke is
    a real row delete, same reasoning as CoordinatorCapabilityGrant -- a
    parallel state column would just be a second source of truth to keep in
    sync with actual access.

    SUPER_ADMIN is never represented by rows here -- it's an implicit "has
    every permission" bypass in app.services.permissions.has_permission, not
    stored data (SUPER ADMIN's permissions are always on and locked)."""

    __tablename__ = "user_permission_grants"
    __table_args__ = (UniqueConstraint("user_id", "permission", name="uq_user_permission_grant"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission: Mapped[PermissionEnum] = mapped_column(
        Enum(PermissionEnum, name="permission_enum"), nullable=False
    )
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    granted_by: Mapped["User | None"] = relationship(foreign_keys=[granted_by_id])

    def __repr__(self) -> str:
        return f"<UserPermissionGrant {self.permission.value} -> {self.user_id}>"
