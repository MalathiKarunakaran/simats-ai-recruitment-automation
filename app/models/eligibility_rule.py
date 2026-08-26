import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import EligibilityRuleStatusEnum, RegulatoryAuthorityEnum, StaffRoleCategoryEnum


class EligibilityRule(Base):
    """Admin-editable rule stating which campus+staff-category (+ optional
    position_title) combinations are permitted to require a given
    qualification keyword (e.g. "PHD") for Teaching positions. The presence
    of a matching active row at a campus is what makes that campus
    "eligible" for the keyword -- see app/services/eligibility.py.

    Extended (starter regulatory-eligibility-rules feature, backend Phase 1)
    with a large batch of richer, mostly-descriptive regulatory-mapping
    fields below (department_id through verification_required). These are
    ALL additive: the original columns above keep their exact existing
    meaning and are the ONLY columns `app/services/eligibility.py`'s live
    `check_qualification_mismatch` reads. In particular `required_keywords`/
    `preferred_keywords` are informational-only hints for a human reviewer
    and `status` is a display/workflow field independent of `is_active` --
    see each field's own docstring below for why neither is wired into any
    live matching/decision logic. The full qualification + specialization +
    percentage + experience + credential + professional-registration +
    regulatory-rule + institutional-rule decision engine implied by some of
    these fields is a distinct, larger future project, not built here.
    """

    __tablename__ = "eligibility_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    staff_category: Mapped[StaffRoleCategoryEnum] = mapped_column(
        Enum(StaffRoleCategoryEnum, name="staff_role_category_enum"), nullable=False
    )
    # Null means "applies to all positions in this category at this campus".
    position_title: Mapped[str | None] = mapped_column(String(150), nullable=True)
    required_qualification_keyword: Mapped[str] = mapped_column(String(100), nullable=False)

    # Category-specific optional columns (Phase 5 / staff-category-as-a-
    # first-class-dimension). All nullable -- a row only populates the
    # columns relevant to its own staff_category; see
    # app/services/eligibility.py::check_qualification_mismatch for how each
    # is consulted. Kept alongside required_qualification_keyword (still the
    # field the existing TEACHING PhD check uses) rather than replacing it.
    # NOTE: despite the name, this also covers SLET (State Eligibility Test),
    # not just NET/SET -- kept as a single boolean rather than adding a
    # redundant column, since "which of NET/SET/SLET" is not something the
    # live matching logic distinguishes.
    net_set_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # Teaching
    subject: Mapped[str | None] = mapped_column(String(150), nullable=True)  # Teaching
    skills_keyword: Mapped[str | None] = mapped_column(String(100), nullable=True)  # Non-Teaching
    id_proof_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # Housekeeping
    shift_preference: Mapped[str | None] = mapped_column(String(100), nullable=True)  # Housekeeping

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Starter regulatory-eligibility-rules fields (additive, all
    # nullable unless noted) ---------------------------------------------

    # Null means "applies to the whole campus/category, not one specific
    # department" -- mirrors how position_title=None already means "applies
    # to all positions".
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    regulatory_authority: Mapped[RegulatoryAuthorityEnum | None] = mapped_column(
        Enum(RegulatoryAuthorityEnum, name="regulatory_authority_enum"), nullable=True
    )
    # Free text, deliberately NOT a lookup table -- same "deliberately not a
    # lookup table" precedent as Department.parent_group. Just a display/
    # filter convenience field (e.g. the campus's own descriptive
    # institutional name for a Teaching rule).
    school_or_college: Mapped[str | None] = mapped_column(String(200), nullable=True)
    programme_discipline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Fuller free-text qualification description -- distinct from
    # required_qualification_keyword above (which stays exactly as-is; it is
    # the field the live keyword-substring match uses). Same style as
    # Designation.qualification.
    minimum_qualification: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free text, not numeric -- real regulatory minimums carry qualifiers
    # ("55% or equivalent CGPA of 6.25/10, relaxable for SC/ST/PWD") that a
    # plain number/percentage column can't represent. Same "free text, not a
    # structured number" precedent as Designation.min_experience.
    minimum_percentage: Mapped[str | None] = mapped_column(String(100), nullable=True)
    required_experience: Mapped[str | None] = mapped_column(String(200), nullable=True)
    required_credential: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Descriptive/informational only -- explicitly NOT consulted by
    # app/services/eligibility.py::check_qualification_mismatch or any other
    # live matching/decision logic. The eligibility decision engine that
    # would actually evaluate these keywords (qualification + specialization
    # + percentage + experience + credential + professional registration +
    # regulatory rule + institutional rule) is a distinct, larger future
    # project. This field is just a human-readable hint for now.
    required_keywords: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Same "descriptive only, not evaluated" contract as required_keywords.
    preferred_keywords: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Teaching-specific structured flag, distinct from the existing
    # keyword-based PhD check (required_qualification_keyword /
    # QUALIFICATION_KEYWORDS in app/services/eligibility.py).
    phd_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    professional_registration: Mapped[str | None] = mapped_column(String(300), nullable=True)
    industry_experience: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Free text -- no fixed value set specified by the requirements; left
    # open, admin-editable.
    priority: Mapped[str | None] = mapped_column(String(50), nullable=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_regulation: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Richer display/workflow status alongside the existing is_active
    # boolean. Deliberately NOT coupled to is_active at the DB level or in
    # any live matching logic -- check_qualification_mismatch keeps
    # filtering ONLY on is_active.is_(True), exactly as before this feature,
    # completely ignoring this column. status is purely for the admin-facing
    # UI/filtering (e.g. so a rule can visibly read "Draft" without needing
    # to infer that from is_active=False alone).
    status: Mapped[EligibilityRuleStatusEnum] = mapped_column(
        Enum(EligibilityRuleStatusEnum, name="eligibility_rule_status_enum"),
        nullable=False,
        default=EligibilityRuleStatusEnum.DRAFT,
        server_default=EligibilityRuleStatusEnum.DRAFT.value,
    )
    verification_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campus: Mapped["Campus"] = relationship()
    department: Mapped["Department | None"] = relationship()

    def __repr__(self) -> str:
        return f"<EligibilityRule {self.staff_category} @ {self.campus_id} ({self.required_qualification_keyword})>"
