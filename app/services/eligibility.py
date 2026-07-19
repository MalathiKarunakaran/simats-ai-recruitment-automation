"""Data-driven eligibility rule engine (Phase 8 addendum, Stage 1).

At application-creation time there is no candidate-side qualification data
yet (resume screening runs after an application exists) -- so this checks
the *vacancy's own declared configuration*: does VacancyRequest.qualification
mention a PhD-style requirement for a Teaching position at a campus not
listed as eligible for that in the eligibility_rules table. Non-blocking --
callers set the resulting flag/reason on the Application and continue; a
human reviews it later. See app/api/v1/routers/applications.py::create_application.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import StaffRoleCategoryEnum

QUALIFICATION_KEYWORDS = ("phd", "ph.d", "doctorate")


def check_qualification_mismatch(
    db: Session,
    *,
    campus_id: uuid.UUID,
    role_category: StaffRoleCategoryEnum,
    position_title: str,
    qualification_text: str,
) -> tuple[bool, str | None]:
    if role_category != StaffRoleCategoryEnum.TEACHING:
        return False, None

    qualification_lower = (qualification_text or "").lower()
    if not any(keyword in qualification_lower for keyword in QUALIFICATION_KEYWORDS):
        return False, None

    base_query = db.query(EligibilityRule).filter(
        EligibilityRule.campus_id == campus_id,
        EligibilityRule.staff_category == StaffRoleCategoryEnum.TEACHING,
        EligibilityRule.is_active.is_(True),
    )

    exact_match = base_query.filter(EligibilityRule.position_title == position_title).one_or_none()
    if exact_match is not None:
        return False, None

    wildcard_match = base_query.filter(EligibilityRule.position_title.is_(None)).one_or_none()
    if wildcard_match is not None:
        return False, None

    campus = db.get(Campus, campus_id)
    campus_label = campus.code if campus is not None else str(campus_id)
    reason = (
        f"The Teaching position '{position_title}' at campus {campus_label} declares a PhD/doctorate "
        "qualification requirement, but PhD-requiring Teaching positions are not listed as eligible "
        f"at campus {campus_label} in the eligibility rules table."
    )
    return True, reason
