import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base


class ResumeScore(Base):
    __tablename__ = "resume_scores"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # One score per application (not per candidate) -- a candidate's resume is
    # screened fresh against each vacancy's JD it's applied to.
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )

    eligibility_score: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False), nullable=True)
    skill_match_pct: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False), nullable=True)
    qualification_match_pct: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False), nullable=True)
    experience_match_pct: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False), nullable=True)
    publication_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overall_recruitment_score: Mapped[float | None] = mapped_column(
        Numeric(5, 2, asdecimal=False), nullable=True, index=True
    )
    # From ChromaDB semantic JD-to-resume similarity, scaled 0-100.
    semantic_similarity_score: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False), nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    extracted_skills: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)), nullable=True)
    extracted_qualification: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_experience_years: Mapped[float | None] = mapped_column(Numeric(4, 1, asdecimal=False), nullable=True)

    is_duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duplicate_of_candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True
    )
    is_incomplete_profile: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    incomplete_reasons: Mapped[list[str] | None] = mapped_column(ARRAY(String(100)), nullable=True)

    screened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    screened_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # e.g. "claude-opus-4-8" -- reproducibility/audit trail for scoring changes
    # across model upgrades.
    model_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped["Application"] = relationship()

    def __repr__(self) -> str:
        return f"<ResumeScore application={self.application_id} score={self.overall_recruitment_score}>"
