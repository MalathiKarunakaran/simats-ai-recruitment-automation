import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Metadata-only stub -- MinIO wiring is Phase 3, same stub pattern as
    # Phase 1's password-reset-email. No upload endpoint yet.
    resume_storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Plain string, not a DB enum -- deliberately unconstrained at the column
    # level so it can grow without a migration; app_level validation (see
    # app/schemas/candidate.py) constrains new writes to the 4 real sourcing
    # channels (Reference/Job Portal/FacultyPlus/Walk-in).
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Who referred the candidate -- only meaningful (and required, enforced
    # in the schema) when source == "Reference".
    reference_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Soft-delete/withdraw -- a candidate is never hard-deleted (their
    # Applications/Employee records must remain queryable for audit/reporting),
    # so this is a flag + timestamp + reason, mirroring Employee's
    # employment_status/separation_date/separation_reason offboarding pattern.
    is_withdrawn: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Candidate {self.email}>"
