import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class TalentPoolResumeField(Base):
    """What a candidate's resume states, kept apart from the sheet row so a sync
    never overwrites it and it never reaches the sheet. A sheet value always wins
    (services/talent_pool_attributes.py). Holds values only, never resume text."""

    __tablename__ = "talent_pool_resume_fields"

    talent_pool_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("talent_pool_entries.id", ondelete="CASCADE"), primary_key=True
    )
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # How each value was reached, so the panel can say "inferred" and show why.
    # `source` is one of resume_field | resume_honorific | resume_pincode |
    # resume_address | unknown (services/talent_pool_inference.py); `evidence` is a
    # short note ("PIN code 600077"), never the address.
    gender_source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    gender_confidence: Mapped[str | None] = mapped_column(String(10), nullable=True)
    gender_evidence: Mapped[str | None] = mapped_column(String(200), nullable=True)
    state_source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    state_confidence: Mapped[str | None] = mapped_column(String(10), nullable=True)
    state_evidence: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Hash of the resume file the script read; an unchanged hash lets it skip the file.
    resume_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    inferred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the ORIGINAL reader (explicit Gender field; home-address word/PIN) reported.
    # Frozen by the migration for existing rows and written only by the old payload
    # shape, so `include_inferred=false` reproduces the pre-inference numbers
    # exactly and no later inference can change them.
    legacy_gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    legacy_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    legacy_country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
