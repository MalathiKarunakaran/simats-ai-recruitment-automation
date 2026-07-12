"""Import every model module so Base.metadata is fully populated for Alembic autogenerate."""

from app.db.base_class import Base
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.auth_token import PasswordResetToken, RefreshToken  # noqa: F401
from app.models.campus import Campus  # noqa: F401
from app.models.department import Department  # noqa: F401
from app.models.user import User  # noqa: F401

__all__ = ["Base"]
