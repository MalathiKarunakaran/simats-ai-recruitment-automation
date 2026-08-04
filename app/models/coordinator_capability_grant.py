import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import CoordinatorCapabilityEnum


class CoordinatorCapabilityGrant(Base):
    """Presence of a row means the RECRUITMENT_COORDINATOR user_id may act
    within `capability`'s gated router group -- see
    app.core.deps.require_roles_or_coordinator_capability. Deliberately no
    "revoked_at" soft-delete column: a revoke is a real row delete, and
    app.services.audit's log_update (called from the
    PUT /users/{id}/capabilities endpoint) captures before/after capability
    lists for history instead of a parallel state column."""

    __tablename__ = "coordinator_capability_grants"
    __table_args__ = (UniqueConstraint("user_id", "capability"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    capability: Mapped[CoordinatorCapabilityEnum] = mapped_column(
        Enum(CoordinatorCapabilityEnum, name="coordinator_capability_enum"), nullable=False
    )
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    granted_by: Mapped["User | None"] = relationship(foreign_keys=[granted_by_id])

    def __repr__(self) -> str:
        return f"<CoordinatorCapabilityGrant {self.capability.value} -> {self.user_id}>"
