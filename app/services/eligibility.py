"""Data-driven eligibility rule engine (Phase 8 addendum, Stage 1; Phase 5
category-awareness addendum).

At application-creation time there is no candidate-side qualification data
yet (resume screening runs after an application exists) -- so this checks
the *vacancy's own declared configuration* (VacancyRequest.qualification,
passed in as qualification_text) against category-specific rules in the
eligibility_rules table. Non-blocking for every category -- callers set the
resulting flag/reason on the Application and continue; a human reviews it
later. See app/api/v1/routers/applications.py::create_application.

Dispatches by role_category to a per-category sub-check, each following the
exact same non-blocking flag-and-continue shape: look for a matching active
EligibilityRule (exact position_title match, else a wildcard
position_title=None rule) at the campus; if one exists, the candidate
combination is considered eligible and the flag stays False. If the
vacancy's own declared text trips a category-specific keyword check and no
matching rule exists, flag=True with a human-readable reason.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import StaffRoleCategoryEnum

QUALIFICATION_KEYWORDS = ("phd", "ph.d", "doctorate")
SKILLS_MISMATCH_KEYWORDS = ("skill", "skills", "proficiency", "certification")
ID_PROOF_KEYWORDS = ("id proof", "identity proof", "aadhaar", "verification")


def _campus_label(db: Session, campus_id: uuid.UUID) -> str:
    campus = db.get(Campus, campus_id)
    return campus.code if campus is not None else str(campus_id)


def _has_matching_active_rule(
    db: Session, *, campus_id: uuid.UUID, staff_category: StaffRoleCategoryEnum, position_title: str
) -> bool:
    base_query = db.query(EligibilityRule).filter(
        EligibilityRule.campus_id == campus_id,
        EligibilityRule.staff_category == staff_category,
        EligibilityRule.is_active.is_(True),
    )

    exact_match = base_query.filter(EligibilityRule.position_title == position_title).one_or_none()
    if exact_match is not None:
        return True

    wildcard_match = base_query.filter(EligibilityRule.position_title.is_(None)).one_or_none()
    return wildcard_match is not None


def _check_teaching(
    db: Session, *, campus_id: uuid.UUID, position_title: str, qualification_text: str
) -> tuple[bool, str | None]:
    qualification_lower = (qualification_text or "").lower()
    if not any(keyword in qualification_lower for keyword in QUALIFICATION_KEYWORDS):
        return False, None

    if _has_matching_active_rule(
        db, campus_id=campus_id, staff_category=StaffRoleCategoryEnum.TEACHING, position_title=position_title
    ):
        return False, None

    campus_label = _campus_label(db, campus_id)
    reason = (
        f"The Teaching position '{position_title}' at campus {campus_label} declares a PhD/doctorate "
        "qualification requirement, but PhD-requiring Teaching positions are not listed as eligible "
        f"at campus {campus_label} in the eligibility rules table."
    )
    return True, reason


def _check_non_teaching(
    db: Session, *, campus_id: uuid.UUID, position_title: str, qualification_text: str
) -> tuple[bool, str | None]:
    """Non-Teaching's equivalent of the Teaching PhD check: the vacancy's own
    declared qualification/skills text names a specific skills requirement,
    but no active EligibilityRule (skills_keyword-bearing or otherwise)
    permits that skills requirement for Non-Teaching positions at this
    campus. Same non-blocking shape as the Teaching branch."""
    qualification_lower = (qualification_text or "").lower()
    if not any(keyword in qualification_lower for keyword in SKILLS_MISMATCH_KEYWORDS):
        return False, None

    if _has_matching_active_rule(
        db, campus_id=campus_id, staff_category=StaffRoleCategoryEnum.NON_TEACHING, position_title=position_title
    ):
        return False, None

    campus_label = _campus_label(db, campus_id)
    reason = (
        f"The Non-Teaching position '{position_title}' at campus {campus_label} declares a specific "
        "skills/certification requirement, but no matching skills-eligible rule is listed for Non-Teaching "
        f"positions at campus {campus_label} in the eligibility rules table."
    )
    return True, reason


def _check_housekeeping(
    db: Session, *, campus_id: uuid.UUID, position_title: str, qualification_text: str
) -> tuple[bool, str | None]:
    """Housekeeping's equivalent check: the vacancy's own declared text names
    an ID-proof/verification or shift requirement, but no active
    EligibilityRule permits that for Housekeeping positions at this campus.
    Same non-blocking shape as the Teaching/Non-Teaching branches."""
    qualification_lower = (qualification_text or "").lower()
    if not any(keyword in qualification_lower for keyword in ID_PROOF_KEYWORDS):
        return False, None

    if _has_matching_active_rule(
        db, campus_id=campus_id, staff_category=StaffRoleCategoryEnum.HOUSEKEEPING, position_title=position_title
    ):
        return False, None

    campus_label = _campus_label(db, campus_id)
    reason = (
        f"The Housekeeping position '{position_title}' at campus {campus_label} declares an ID proof/"
        "verification requirement, but no matching rule is listed for Housekeeping positions at campus "
        f"{campus_label} in the eligibility rules table."
    )
    return True, reason


_CHECKS_BY_CATEGORY = {
    StaffRoleCategoryEnum.TEACHING: _check_teaching,
    StaffRoleCategoryEnum.NON_TEACHING: _check_non_teaching,
    StaffRoleCategoryEnum.HOUSEKEEPING: _check_housekeeping,
}


def check_qualification_mismatch(
    db: Session,
    *,
    campus_id: uuid.UUID,
    role_category: StaffRoleCategoryEnum,
    position_title: str,
    qualification_text: str,
) -> tuple[bool, str | None]:
    check = _CHECKS_BY_CATEGORY.get(role_category)
    if check is None:
        return False, None
    return check(db, campus_id=campus_id, position_title=position_title, qualification_text=qualification_text)


# --------------------------------------------------------------------------
# Candidate-side PhD mandate (2026-09-05).
#
# Everything above checks the VACANCY's declared text. This checks the
# CANDIDATE: at SIMATS a PhD is mandatory for every teaching post at some
# colleges (SSE, SCLAS, SSPE at the time of writing) and not at others. The
# mandate is data, not code: an ACTIVE TEACHING EligibilityRule at the campus
# with `phd_required=True` (position_title / department_id NULL = every
# teaching post there; set either to narrow it). scripts/seed_phd_mandate_rules.py
# creates the institutional ones; the Eligibility Rules screen edits them.
#
# Enforced at resume screening (resume_screening.run_screening): a resume
# whose extracted qualification names no PhD/doctorate flags the application
# with a reason starting with PHD_MANDATE_REASON_PREFIX and zeroes its
# eligibility score. pipeline.transition_application_status then refuses to
# call that candidate for interview unless HR overrides with a reason.

PHD_MANDATE_REASON_PREFIX = "PhD is mandatory"


def phd_mandate_rule_for_vacancy(
    db: Session, *, campus_id: uuid.UUID, department_id: uuid.UUID | None, position_title: str
) -> EligibilityRule | None:
    """The most specific active TEACHING rule with phd_required at this
    campus that applies to this department + position, or None."""
    candidates = (
        db.query(EligibilityRule)
        .filter(
            EligibilityRule.campus_id == campus_id,
            EligibilityRule.staff_category == StaffRoleCategoryEnum.TEACHING,
            EligibilityRule.is_active.is_(True),
            EligibilityRule.phd_required.is_(True),
        )
        .all()
    )
    applicable = [
        rule
        for rule in candidates
        if (rule.department_id is None or rule.department_id == department_id)
        and (rule.position_title is None or rule.position_title == position_title)
    ]
    if not applicable:
        return None
    # Most specific first: department + position, then either, then wildcard.
    applicable.sort(key=lambda r: (r.department_id is None, r.position_title is None))
    return applicable[0]


def candidate_holds_phd(extracted_qualification: str | None) -> bool:
    text = (extracted_qualification or "").lower()
    return any(keyword in text for keyword in QUALIFICATION_KEYWORDS)


def check_candidate_phd_requirement(
    db: Session, *, application, extracted_qualification: str | None
) -> tuple[bool, str | None]:
    """(mandate_unmet, reason). Only ever True for a TEACHING application at
    a campus with an active PhD mandate whose resume shows no PhD."""
    if application.role_category != StaffRoleCategoryEnum.TEACHING:
        return False, None
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    rule = phd_mandate_rule_for_vacancy(
        db,
        campus_id=application.campus_id,
        department_id=vacancy_request.department_id,
        position_title=vacancy_request.position_title,
    )
    if rule is None or candidate_holds_phd(extracted_qualification):
        return False, None
    shown = (extracted_qualification or "").strip() or "no qualification could be read from the resume"
    reason = (
        f"{PHD_MANDATE_REASON_PREFIX} for teaching posts at {_campus_label(db, application.campus_id)}; "
        f"the resume shows: {shown}. HR can override this with a reason."
    )
    return True, reason


def is_phd_mandate_flag(application) -> bool:
    return bool(
        application.qualification_mismatch
        and (application.qualification_mismatch_reason or "").startswith(PHD_MANDATE_REASON_PREFIX)
    )

