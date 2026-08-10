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
