"""Import every model module so SQLAlchemy's mapper registry can resolve
string-based relationship() references regardless of which module is
imported first (e.g. a script that only imports `User` directly)."""

from app.models.audit_log import AuditLog  # noqa: F401
from app.models.auth_token import PasswordResetToken, RefreshToken  # noqa: F401
from app.models.campus import Campus  # noqa: F401
from app.models.department import Department  # noqa: F401
from app.models.user import User  # noqa: F401
