from sqlalchemy import Column, ForeignKey, Table
from sqlalchemy.dialects.postgresql import UUID

from app.db.base_class import Base

# Pure join table (no independent identity) between User and Department --
# an additional, more expressive multi-department access-scope mechanism
# alongside the existing single-department User.department_id FK (left
# untouched; a later phase decides how to fully reconcile the two, e.g.
# keeping department_id as a "primary" department while this table becomes
# the authoritative access-scope list). Mirrors
# app.models.designation.designation_departments's exact Table(...) shape.
user_department_scope = Table(
    "user_department_scope",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "department_id",
        UUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
