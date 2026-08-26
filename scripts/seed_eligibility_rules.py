"""Starter regulatory eligibility-rules seed script.

Populates `eligibility_rules` with a real, department-level-accurate starter
set covering every existing campus/department, mapped to the regulatory
authority that governs each discipline (AICTE/COA/UGC/NCTE/Institution),
per the user's own explicit authority-mapping brief. Every row this script
creates is DRAFT/unverified by design:

    status = DRAFT
    is_active = False
    verification_required = True
    source_regulation ends with "Starter regulatory mapping -- verify
        before activation."

None of these rows affect live recruitment: `app/services/eligibility.py`'s
`check_qualification_mismatch` only ever reads `is_active`, which every row
here sets to False. A human (via the app's own Eligibility Rules page) must
explicitly review, correct, and activate a rule before it has any real
effect.

**Idempotent / safe to re-run**: before inserting, each row is checked
against the same 5-field natural key the app's own API enforces (campus +
department + position_title + regulatory_authority + effective_from) --
re-running this script never creates duplicates, it just reports what
already exists and skips it.

**Portable across databases on purpose**: campus and department IDs are
resolved by CODE/NAME at runtime via SessionLocal (whatever DATABASE_URL is
configured for the process running this script), never hardcoded -- so the
exact same script file runs correctly against local dev and against
production without any UUID edits, since those two databases have different
real UUIDs for the same logical rows.

Usage:
    venv/Scripts/python.exe -m scripts.seed_eligibility_rules            # apply
    venv/Scripts/python.exe -m scripts.seed_eligibility_rules --dry-run  # report only, no writes

Run against production via the backend container's own DATABASE_URL (see
DEPLOYMENT.md) -- e.g. `docker exec <backend> python -m scripts.seed_eligibility_rules`.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.campus import Campus
from app.models.department import Department
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import EligibilityRuleStatusEnum, RegulatoryAuthorityEnum, StaffRoleCategoryEnum

SOURCE_SUFFIX = "Starter regulatory mapping -- verify before activation."

# Departments/designations known to be test fixtures from earlier
# live-verification sessions -- never generate starter rules for these.
_EXCLUDED_DEPARTMENT_NAME_MARKERS = ("ZZZ_LIVE_VERIFY", "PHASE K VERIFY", "WIZARD LIVE-CHECK")


def _is_test_fixture(name: str) -> bool:
    upper = name.upper()
    return any(marker in upper for marker in _EXCLUDED_DEPARTMENT_NAME_MARKERS)


@dataclass
class RuleSpec:
    campus_code: str
    department_name: str | None  # None = applies campus/category-wide, no single department
    staff_category: StaffRoleCategoryEnum
    position_title: str
    regulatory_authority: RegulatoryAuthorityEnum
    required_qualification_keyword: str
    minimum_qualification: str | None = None
    minimum_percentage: str | None = None
    required_experience: str | None = None
    required_credential: str | None = None
    professional_registration: str | None = None
    industry_experience: str | None = None
    phd_required: bool | None = None
    net_set_required: bool | None = None
    programme_discipline: str | None = None
    school_or_college: str | None = None
    source_regulation_prefix: str = ""
    notes: str | None = None


# --- Academic rank ladder templates (Teaching only) -------------------------

_RANK_TEMPLATES = [
    dict(
        position_title="Assistant Professor",
        phd_required=False,
        net_set_required=True,
        required_qualification_keyword="MASTERS",
        minimum_qualification=(
            "Master's Degree in the relevant discipline with First Class or equivalent "
            "(PhD preferred; NET/SET/SLET required if PhD not held)."
        ),
        minimum_percentage="55% or equivalent CGPA (relaxable per applicable reservation-category norms) -- verify",
        required_experience="Entry level -- as per applicable regulatory norms, verify",
    ),
    dict(
        position_title="Associate Professor",
        phd_required=True,
        net_set_required=False,
        required_qualification_keyword="PHD",
        minimum_qualification="PhD in the relevant discipline.",
        minimum_percentage="55% or equivalent CGPA at Master's level -- verify",
        required_experience="8+ years of teaching/research/industry experience -- verify",
    ),
    dict(
        position_title="Professor",
        phd_required=True,
        net_set_required=False,
        required_qualification_keyword="PHD",
        minimum_qualification="PhD in the relevant discipline.",
        minimum_percentage="55% or equivalent CGPA at Master's level -- verify",
        required_experience=(
            "10+ years of teaching/research/industry experience, including at least 3 years "
            "as Associate Professor -- verify"
        ),
    ),
]

_INDUSTRY_FACULTY_TEMPLATE = dict(
    position_title="Industry/Professional Faculty",
    phd_required=False,
    net_set_required=False,
    required_qualification_keyword="MASTERS",
    minimum_qualification="Bachelor's/Master's Degree in the relevant design discipline, with significant industry practice.",
    minimum_percentage=None,
    required_experience=None,
    industry_experience="5+ years of relevant industry experience -- verify",
)


def _teaching_ladder(
    *,
    campus_code: str,
    department_name: str,
    authority: RegulatoryAuthorityEnum,
    programme_discipline: str,
    school_or_college: str,
    extra_industry_row: bool = False,
    professional_registration: str | None = None,
    notes: str | None = None,
) -> list[RuleSpec]:
    templates = list(_RANK_TEMPLATES) + ([_INDUSTRY_FACULTY_TEMPLATE] if extra_industry_row else [])
    specs = []
    for t in templates:
        specs.append(
            RuleSpec(
                campus_code=campus_code,
                department_name=department_name,
                staff_category=StaffRoleCategoryEnum.TEACHING,
                position_title=t["position_title"],
                regulatory_authority=authority,
                required_qualification_keyword=t["required_qualification_keyword"],
                minimum_qualification=t["minimum_qualification"],
                minimum_percentage=t.get("minimum_percentage"),
                required_experience=t.get("required_experience"),
                industry_experience=t.get("industry_experience"),
                phd_required=t["phd_required"],
                net_set_required=t["net_set_required"],
                programme_discipline=programme_discipline,
                school_or_college=school_or_college,
                professional_registration=professional_registration,
                notes=notes,
            )
        )
    return specs


def _support_role(
    *, campus_code: str, department_name: str, position_title: str, notes: str
) -> RuleSpec:
    """Non-degree trainer/support Teaching-category department -- no
    academic rank ladder applies; regulatory authority is honestly
    UNMAPPED_VERIFY (institution-determined, not covered by AICTE/UGC/COA/
    NCTE)."""
    return RuleSpec(
        campus_code=campus_code,
        department_name=department_name,
        staff_category=StaffRoleCategoryEnum.TEACHING,
        position_title=position_title,
        regulatory_authority=RegulatoryAuthorityEnum.UNMAPPED_VERIFY,
        required_qualification_keyword="RELEVANT_QUALIFICATION",
        minimum_qualification="Bachelor's/Master's Degree relevant to the role -- as per institutional norms.",
        required_experience="As per department norms -- verify",
        notes=notes,
    )


# --- Build the full Teaching starter-rule set --------------------------------

TEACHING_SPECS: list[RuleSpec] = []

# SSE -- core engineering (12 depts) -> AICTE_UGC, clean match.
for dept in [
    "ARTIFICIAL INTELLIGENCE AND DATA SCIENCE",
    "ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING",
    "BIOINFORMATICS",
    "BIOMEDICAL ENGINEERING",
    "BIOTECHNOLOGY",
    "CIVIL ENGINEERING",
    "COMPUTER SCIENCE AND ENGINEERING",
    "ELECTRICAL AND ELECTRONICS AND ENGINEERING",
    "ELECTRONICS AND COMMUNICATION ENGINEERING",
    "ENERGY AND ENVIRONMENTAL ENGINEERING",
    "INFORMATION TECHNOLOGY",
    "MECHANICAL ENGINEERING",
]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="SSE",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.AICTE_UGC,
        programme_discipline=f"B.Tech {dept.title()}",
        school_or_college="SIMATS Engineering",
    )

# SSE -- basic sciences (3 depts) -> AICTE_UGC (serve the B.Tech curriculum),
# medium confidence -- flagged in notes.
for dept in ["CHEMISTRY", "MATHS", "PHYSICS"]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="SSE",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.AICTE_UGC,
        programme_discipline=f"Basic Sciences -- {dept.title()}",
        school_or_college="SIMATS Engineering",
        notes=(
            "Basic-sciences department serving the B.Tech curriculum -- mapped to AICTE_UGC "
            "since it supports an AICTE-approved programme, but faculty qualification norms may "
            "follow UGC directly. Medium confidence, verify."
        ),
    )

# SSE -- MBA -> genuinely ambiguous per the task's own instruction.
TEACHING_SPECS += _teaching_ladder(
    campus_code="SSE",
    department_name="MBA",
    authority=RegulatoryAuthorityEnum.UGC_AICTE_INSTITUTION,
    programme_discipline="MBA",
    school_or_college="SIMATS Engineering",
    notes="MBA approval/qualification-norm authority varies AICTE vs UGC by institution -- not force-classified, verify.",
)

# SSE -- languages/humanities (4 depts) -> UGC, medium confidence.
for dept in ["ENGLISH", "FOREIGN LANGUAGE", "HINDI", "TAMIL"]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="SSE",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.UGC,
        programme_discipline=f"{dept.title()} (Humanities/Languages)",
        school_or_college="SIMATS Engineering",
        notes="Humanities/language faculty within an engineering campus -- UGC-style, verify.",
    )

# SSE -- non-degree trainer/support roles -> UNMAPPED_VERIFY, one rule each.
TEACHING_SPECS += [
    _support_role(
        campus_code="SSE", department_name="SOFTSKILLS", position_title="Soft Skills Trainer",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    ),
    _support_role(
        campus_code="SSE", department_name="TECH TRAINER", position_title="Tech Trainer",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    ),
    _support_role(
        campus_code="SSE", department_name="SPORTS", position_title="Sports Coach",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    ),
    _support_role(
        campus_code="SSE", department_name="PLACEMENT", position_title="Placement Officer",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    ),
    _support_role(
        campus_code="SSE", department_name="YOGA", position_title="Yoga Instructor",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    ),
]

# SCAD -- Architecture (clean COA match) + VISCOMM (Design, ambiguous).
TEACHING_SPECS += _teaching_ladder(
    campus_code="SCAD",
    department_name="ARCHITECTURE",
    authority=RegulatoryAuthorityEnum.COA,
    programme_discipline="Architecture",
    school_or_college="Saveetha College Architecture and Design",
    professional_registration="Council of Architecture (COA) registration required -- verify",
)
TEACHING_SPECS += _teaching_ladder(
    campus_code="SCAD",
    department_name="VISCOMM",
    authority=RegulatoryAuthorityEnum.UGC_AICTE_INSTITUTION,
    programme_discipline="Visual Communication (Design)",
    school_or_college="Saveetha College Architecture and Design",
    extra_industry_row=True,
    notes="Design programme -- not automatically classified as AICTE, determine per programme, verify.",
)

# SCLAS -- Arts & Science (7 depts, UGC) + PLACEMENT (support, unmapped).
for dept in [
    "BHARATHAM", "BUSINESS ADMINISTRATION", "COMMERCE", "COMPUTER APPLICATIONS",
    "COMPUTER SCIENCE", "ECONOMICS", "MUSIC",
]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="SCLAS",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.UGC,
        programme_discipline=dept.title(),
        school_or_college="Saveetha College of Liberal Arts and Science",
    )
TEACHING_SPECS.append(
    _support_role(
        campus_code="SCLAS", department_name="PLACEMENT", position_title="Placement Officer",
        notes="Non-degree support role, not an academic regulatory-body programme.",
    )
)

# STUDIO -- Design (4 depts), genuinely ambiguous per the task's own
# explicit "don't auto-classify Design as AICTE" instruction. Include the
# Industry/Professional Faculty row per the task's Design-specific ask.
for dept in ["ARTIST - MFA", "FASHION DESIGN", "INTERIOR DESIGN", "PRODUCT DESIGN"]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="STUDIO",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.UGC_AICTE_INSTITUTION,
        programme_discipline=dept.title(),
        school_or_college="SIMATS Technological Unison of Design Innovation Outreach",
        extra_industry_row=True,
        notes="Design programme -- not automatically classified as AICTE, determine per programme, verify.",
    )

# SPIER -- Education (clean NCTE match).
TEACHING_SPECS += _teaching_ladder(
    campus_code="SPIER",
    department_name="EDUCATION",
    authority=RegulatoryAuthorityEnum.NCTE_UGC,
    programme_discipline="Teacher Education",
    school_or_college="Saveetha Pedagogical Institute of Education and Research",
)

# SSPE -- Physical Education, NCTE-plausible but medium confidence (B.P.Ed/
# M.P.Ed are typically NCTE-regulated in India, but not certain here).
TEACHING_SPECS += _teaching_ladder(
    campus_code="SSPE",
    department_name="SSPE",
    authority=RegulatoryAuthorityEnum.NCTE_UGC,
    programme_discipline="Physical Education",
    school_or_college="Saveetha School of Physical Education",
    notes="B.P.Ed/M.P.Ed programmes are typically NCTE-regulated in India -- medium confidence, verify.",
)

# SHIFT -- Hospitality/Aviation/Tourism, genuinely no fit among the 7 given
# authorities. Explicitly flagged, not forced into any of them.
for dept in ["CHEF", "HOTEL MANAGEMENT"]:
    TEACHING_SPECS += _teaching_ladder(
        campus_code="SHIFT",
        department_name=dept,
        authority=RegulatoryAuthorityEnum.UNMAPPED_VERIFY,
        programme_discipline=dept.title(),
        school_or_college="Saveetha School of Hospitality Aviation and Tourism",
        notes=(
            "No campus/programme regulatory authority among AICTE/COA/UGC/NCTE/Institution safely "
            "fits Hospitality/Aviation/Tourism -- flagged as unmapped rather than guessed, verify."
        ),
    )

# --- Non-Teaching + Housekeeping starter rules, per campus -------------------

NON_TEACHING_POSITIONS = [
    ("Administrative Staff", "Bachelor's Degree in any discipline -- as per institutional norms."),
    ("Office Assistant", "Higher Secondary / Bachelor's Degree -- as per institutional norms."),
    ("Technical Staff", "Diploma/ITI or Bachelor's Degree in the relevant technical field -- as per institutional norms."),
    ("Lab Technician", "Diploma/Bachelor's Degree in the relevant science/engineering field -- as per institutional norms."),
    ("IT Support", "Diploma/Bachelor's Degree in Computer Science/IT or equivalent -- as per institutional norms."),
    ("Accounts Staff", "B.Com or equivalent -- as per institutional norms."),
    ("HR Staff", "Bachelor's/Master's Degree, HR specialization preferred -- as per institutional norms."),
]

HOUSEKEEPING_POSITIONS = [
    ("Housekeeping Staff", "As per Institution HR policy -- verify."),
    ("Supervisor", "As per Institution HR policy; prior housekeeping experience preferred -- verify."),
    ("Cleaner", "As per Institution HR policy -- verify."),
    ("Attender", "As per Institution HR policy -- verify."),
]

NON_TEACHING_HOUSEKEEPING_SPECS: list[RuleSpec] = []
for campus_code in ["SSE", "SCAD", "SCLAS", "STUDIO", "SPIER", "SSPE", "SHIFT"]:
    for position_title, qual in NON_TEACHING_POSITIONS:
        NON_TEACHING_HOUSEKEEPING_SPECS.append(
            RuleSpec(
                campus_code=campus_code,
                department_name=None,  # campus/category-wide, not one specific department
                staff_category=StaffRoleCategoryEnum.NON_TEACHING,
                position_title=position_title,
                regulatory_authority=RegulatoryAuthorityEnum.INSTITUTION_NON_TEACHING,
                required_qualification_keyword="RELEVANT_QUALIFICATION",
                minimum_qualification=qual,
                required_experience="As per department norms -- verify",
            )
        )
    for position_title, qual in HOUSEKEEPING_POSITIONS:
        NON_TEACHING_HOUSEKEEPING_SPECS.append(
            RuleSpec(
                campus_code=campus_code,
                department_name=None,
                staff_category=StaffRoleCategoryEnum.HOUSEKEEPING,
                position_title=position_title,
                regulatory_authority=RegulatoryAuthorityEnum.INSTITUTION_HR_HOUSEKEEPING,
                required_qualification_keyword="RELEVANT_QUALIFICATION",
                minimum_qualification=qual,
            )
        )

ALL_SPECS: list[RuleSpec] = TEACHING_SPECS + NON_TEACHING_HOUSEKEEPING_SPECS


def _resolve_campus(db: Session, code: str) -> Campus:
    campus = db.query(Campus).filter(Campus.code == code).one_or_none()
    if campus is None:
        raise RuntimeError(f"Campus code {code!r} not found -- cannot seed against a stale campus list.")
    return campus


def _resolve_department(db: Session, campus_id, name: str) -> Department:
    dept = (
        db.query(Department)
        .filter(Department.campus_id == campus_id, Department.name == name, Department.is_active.is_(True))
        .one_or_none()
    )
    if dept is None:
        raise RuntimeError(f"Active department {name!r} not found on this campus -- cannot seed against stale data.")
    if _is_test_fixture(dept.name):
        raise RuntimeError(f"Refusing to seed against apparent test-fixture department {dept.name!r}.")
    return dept


def _existing_conflict(
    db: Session, *, campus_id, department_id, position_title, regulatory_authority, effective_from
) -> EligibilityRule | None:
    query = db.query(EligibilityRule).filter(EligibilityRule.campus_id == campus_id)
    query = (
        query.filter(EligibilityRule.department_id == department_id)
        if department_id is not None
        else query.filter(EligibilityRule.department_id.is_(None))
    )
    query = query.filter(EligibilityRule.position_title == position_title)
    query = (
        query.filter(EligibilityRule.regulatory_authority == regulatory_authority)
        if regulatory_authority is not None
        else query.filter(EligibilityRule.regulatory_authority.is_(None))
    )
    query = (
        query.filter(EligibilityRule.effective_from == effective_from)
        if effective_from is not None
        else query.filter(EligibilityRule.effective_from.is_(None))
    )
    return query.first()


def run(dry_run: bool) -> None:
    db = SessionLocal()
    created = 0
    skipped_existing = 0
    by_authority: dict[str, int] = {}
    by_category: dict[str, int] = {}

    try:
        for spec in ALL_SPECS:
            campus = _resolve_campus(db, spec.campus_code)
            department = (
                _resolve_department(db, campus.id, spec.department_name)
                if spec.department_name
                else None
            )

            conflict = _existing_conflict(
                db,
                campus_id=campus.id,
                department_id=department.id if department else None,
                position_title=spec.position_title,
                regulatory_authority=spec.regulatory_authority,
                effective_from=None,
            )
            if conflict is not None:
                skipped_existing += 1
                continue

            source_regulation = SOURCE_SUFFIX if not spec.source_regulation_prefix else (
                f"{spec.source_regulation_prefix} {SOURCE_SUFFIX}"
            )

            rule = EligibilityRule(
                campus_id=campus.id,
                department_id=department.id if department else None,
                staff_category=spec.staff_category,
                position_title=spec.position_title,
                required_qualification_keyword=spec.required_qualification_keyword,
                net_set_required=spec.net_set_required,
                regulatory_authority=spec.regulatory_authority,
                school_or_college=spec.school_or_college,
                programme_discipline=spec.programme_discipline,
                minimum_qualification=spec.minimum_qualification,
                minimum_percentage=spec.minimum_percentage,
                required_experience=spec.required_experience,
                required_credential=spec.required_credential,
                phd_required=spec.phd_required,
                professional_registration=spec.professional_registration,
                industry_experience=spec.industry_experience,
                source_regulation=source_regulation,
                status=EligibilityRuleStatusEnum.DRAFT,
                verification_required=True,
                is_active=False,
                notes=spec.notes,
            )
            if not dry_run:
                db.add(rule)
            created += 1
            by_authority[spec.regulatory_authority.value] = by_authority.get(spec.regulatory_authority.value, 0) + 1
            by_category[spec.staff_category.value] = by_category.get(spec.staff_category.value, 0) + 1

        if dry_run:
            db.rollback()
        else:
            db.commit()

        print(f"{'[DRY RUN] ' if dry_run else ''}Eligibility rules seed complete.")
        print(f"  Created: {created}")
        print(f"  Skipped (already existed): {skipped_existing}")
        print(f"  By staff_category: {by_category}")
        print(f"  By regulatory_authority: {by_authority}")
        unmapped = by_authority.get("UNMAPPED_VERIFY", 0)
        ambiguous = by_authority.get("UGC_AICTE_INSTITUTION", 0)
        print(f"  Flagged UNMAPPED_VERIFY (no safe authority determined): {unmapped}")
        print(f"  Flagged UGC_AICTE_INSTITUTION (Design/ambiguous, needs human determination): {ambiguous}")
        print("  All rows: status=DRAFT, is_active=False, verification_required=True.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report what would be created, write nothing.")
    args = parser.parse_args()
    try:
        run(dry_run=args.dry_run)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
