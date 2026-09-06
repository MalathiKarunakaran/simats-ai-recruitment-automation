"""Recruitment channels and the deterministic rules that recommend them.

Before 2026-09-06 a "channel" was one of four string constants in
app/services/job_distribution.py and the only record of where a posting had
gone was a pair of audit actions. A channel is now a row an admin can add,
rename, or retire without a deploy, and a rule is a row that says which
channels a new posting should be recommended on -- matched by category,
campus, department, designation, or employment type, most specific first.

AI never writes these tables. The recommender (a later step) may add
RECOMMENDED rows to a posting with a reason; which channels exist and which
are auto-selected stays a human, auditable decision.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import (
    EmploymentTypeEnum,
    RecruitmentChannelKindEnum,
    RecruitmentChannelModeEnum,
    StaffRoleCategoryEnum,
)


class RecruitmentChannel(Base):
    __tablename__ = "recruitment_channels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # Stable machine code, upper-case, what n8n and the legacy distribute
    # endpoint address a channel by ("LINKEDIN"). Never renamed once used.
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[RecruitmentChannelKindEnum] = mapped_column(
        Enum(RecruitmentChannelKindEnum, name="recruitment_channel_kind_enum"), nullable=False
    )
    mode: Mapped[RecruitmentChannelModeEnum] = mapped_column(
        Enum(RecruitmentChannelModeEnum, name="recruitment_channel_mode_enum"), nullable=False
    )
    # API mode: the n8n webhook path under N8N_BASE_URL. FEED mode: the feed
    # path. NULL for MANUAL_ASSISTED and INTERNAL. Secrets never live here --
    # n8n holds every portal credential.
    integration_path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Non-secret per-channel settings (default expiry days, mailing-list id,
    # feed format). Free-form on purpose: each n8n workflow reads what it needs.
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Which staff categories this channel makes sense for. Empty = all.
    applicable_categories: Mapped[list[StaffRoleCategoryEnum]] = mapped_column(
        ARRAY(Enum(StaffRoleCategoryEnum, name="staff_role_category_enum", create_type=False)),
        nullable=False,
        server_default="{}",
    )
    # Which campuses. Empty = all. Plain uuid array, not a link table: this
    # is a small filter list edited by an admin, not a relationship anyone
    # navigates from the campus side.
    applicable_campus_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def applies_to(self, *, category: StaffRoleCategoryEnum, campus_id: uuid.UUID) -> bool:
        if self.applicable_categories and category not in self.applicable_categories:
            return False
        if self.applicable_campus_ids and campus_id not in self.applicable_campus_ids:
            return False
        return True

    def __repr__(self) -> str:
        return f"<RecruitmentChannel {self.code} ({self.mode.value})>"


class ChannelRule(Base):
    """One row = "postings matching these facts get these channels". Every
    match_* column is nullable and NULL means "any"; a rule with more
    non-NULL match columns is more specific and, at equal specificity, the
    higher `priority` wins. Evaluation lives in app/services/job_channels.py
    and is plain comparison -- no scoring, no model."""

    __tablename__ = "channel_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    match_category: Mapped[StaffRoleCategoryEnum | None] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum", create_type=False), nullable=True
    )
    match_campus_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="CASCADE"), nullable=True
    )
    match_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="CASCADE"), nullable=True
    )
    match_designation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id", ondelete="CASCADE"), nullable=True
    )
    match_employment_type: Mapped[EmploymentTypeEnum | None] = mapped_column(
        Enum(EmploymentTypeEnum, name="employment_type_enum", create_type=False), nullable=True
    )
    # Channels to recommend. A retired channel is skipped at evaluation time
    # rather than scrubbed from every rule, so re-activating it needs no edit.
    channel_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"
    )
    # True: the recommendation lands already SELECTED (no review needed --
    # the careers page, for example). False: a recruiter must select it.
    auto_select: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus | None"] = relationship()  # noqa: F821
    department: Mapped["Department | None"] = relationship()  # noqa: F821
    designation: Mapped["Designation | None"] = relationship()  # noqa: F821

    @property
    def specificity(self) -> int:
        return sum(
            1
            for value in (
                self.match_category,
                self.match_campus_id,
                self.match_department_id,
                self.match_designation_id,
                self.match_employment_type,
            )
            if value is not None
        )

    def __repr__(self) -> str:
        return f"<ChannelRule {self.name} (priority {self.priority})>"
