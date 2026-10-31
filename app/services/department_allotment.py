"""Department allotment rules (docs/specs/provisional-order-and-allotment.md,
Q4): which departments an application can be allotted to, which one to
suggest, and the vacancy > 0 rule with its Super Admin override.

Vacancy = sanctioned - working - reserved, where sanctioned/working come
from `sanctioned_strength` (the same resolver and `working_count_for` /
`resolved_working_for` every other read path uses -- no second counter) and
`reserved` counts OTHER applications already allotted to that department
for the same designation and not yet handed over. Vacancy still drops for
real only at hand-over, when the Employee row is created (decision D,
29-Oct); `reserved` only stops two people being allotted the last seat.

The suggestion is a plain word match between the candidate's qualification
text and the department name, shown to the user and never applied.
"""

import re
import uuid

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.department import Department
from app.models.enums import ApplicationStatusEnum, UserRoleEnum
from app.models.resume_score import ResumeScore
from app.models.user import User
from app.services import sanctioned_strength
from app.services.audit import log_event
from app.services.joining import _resolve_designation_id

# Allotted but not yet handed over: the seat is taken, the Employee row (and
# so the working count) does not exist yet.
RESERVING_STATUSES = (ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED, ApplicationStatusEnum.ORIENTATION_COMPLETE)

SUGGESTION_FROM_RESUME = "RESUME_QUALIFICATION"
SUGGESTION_FROM_VACANCY = "VACANCY"

# Words too common in department names / qualifications to mean a match.
_STOPWORDS = {
    "and", "the", "for", "with", "department", "dept", "school", "college", "faculty",
    "studies", "science", "sciences", "engineering", "technology", "degree", "master",
    "masters", "bachelor", "doctor", "philosophy", "phd", "university", "institute",
}


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) >= 3 and w not in _STOPWORDS}


def application_designation_id(db: Session, application: Application) -> uuid.UUID | None:
    """The Designation this application hires for -- the vacancy request's,
    else the same exact-name match the hand-over uses."""
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    return _resolve_designation_id(db, vacancy_request, vacancy_request.position_title)


def _suggestion_text(db: Session, application: Application) -> tuple[str, str]:
    """(basis, text). The candidate's own qualification as extracted from the
    resume when the application was screened; the Candidate model holds no
    qualification/specialisation of its own. Unscreened applications fall
    back to the vacancy's position title and department, which suggests the
    department the vacancy was raised for."""
    score = db.query(ResumeScore).filter(ResumeScore.application_id == application.id).one_or_none()
    if score is not None and (score.extracted_qualification or "").strip():
        return SUGGESTION_FROM_RESUME, score.extracted_qualification.strip()
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    return SUGGESTION_FROM_VACANCY, f"{vacancy_request.position_title} {vacancy_request.department.name}"


def _reserved_by_department(
    db: Session, application: Application, designation_id: uuid.UUID, department_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not department_ids:
        return {}
    others = (
        db.query(Application)
        .filter(
            Application.id != application.id,
            Application.campus_id == application.campus_id,
            Application.department_allotted_id.in_(department_ids),
            Application.status.in_(RESERVING_STATUSES),
        )
        .all()
    )
    counts: dict[uuid.UUID, int] = {}
    for other in others:
        if application_designation_id(db, other) == designation_id:
            counts[other.department_allotted_id] = counts.get(other.department_allotted_id, 0) + 1
    return counts


def department_options(db: Session, application: Application) -> dict:
    designation_id = application_designation_id(db, application)
    basis, text = _suggestion_text(db, application)
    result = {
        "designation_id": designation_id,
        "suggestion_basis": basis,
        "suggestion_text": text,
        "options": [],
    }
    if designation_id is None:
        return result

    rows = [
        row
        for row in sanctioned_strength.current_effective_rows(
            db, campus_id=application.campus_id, designation_id=designation_id
        )
        if row.category == application.role_category
    ]
    departments = {
        d.id: d
        for d in db.query(Department).filter(
            Department.id.in_([r.department_id for r in rows]), Department.is_active.is_(True)
        )
    }
    reserved = _reserved_by_department(db, application, designation_id, list(departments))
    candidate_words = _words(text)

    options = []
    for row in rows:
        department = departments.get(row.department_id)
        if department is None:
            continue
        working = sanctioned_strength.resolved_working_for(
            row,
            sanctioned_strength.working_count_for(
                db,
                department_id=row.department_id,
                designation_id=designation_id,
                category=row.category,
                location_id=row.location_id,
            ),
        )
        held = reserved.get(department.id, 0)
        options.append(
            {
                "department_id": department.id,
                "department_name": department.name,
                "sanctioned": row.approved_strength,
                "working": working,
                "reserved": held,
                "vacancy": max(row.approved_strength - working - held, 0),
                "suggested": bool(candidate_words & _words(department.name)),
            }
        )
    options.sort(key=lambda o: (not o["suggested"], o["department_name"].lower()))
    result["options"] = options
    return result


def check_allotment(
    db: Session,
    *,
    application: Application,
    department_id: uuid.UUID,
    override_reason: str | None,
    actor: User,
    request: Request | None = None,
) -> None:
    """Refuses (409) a department with no vacancy unless a Super Admin sends
    an override reason, which is audited as its own event. Call before the
    allotment is written, in the same transaction."""
    department = db.get(Department, department_id)
    if department is None or department.campus_id != application.campus_id or not department.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive department for this campus"
        )

    designation_id = application_designation_id(db, application)
    if designation_id is not None:
        # Two allotments racing for the last seat serialise here.
        sanctioned_strength.lock_key_for_update(
            db, campus_id=application.campus_id, department_id=department_id, designation_id=designation_id
        )
    option = next(
        (o for o in department_options(db, application)["options"] if o["department_id"] == department_id), None
    )
    vacancy = option["vacancy"] if option is not None else 0
    if vacancy > 0:
        return

    reason = (override_reason or "").strip()
    if reason and actor.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin may override the vacancy rule"
        )
    if actor.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{department.name} has no vacancy for this designation"
                + (" (no Sanctioned Strength row)" if option is None else "")
                + ". Only a Super Admin can override."
            ),
        )
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{department.name} has no vacancy for this designation; an override reason is required.",
        )
    log_event(
        db,
        actor=actor,
        action="DEPARTMENT_ALLOTMENT_VACANCY_OVERRIDE",
        campus_context_id=application.campus_id,
        entity_type="Application",
        entity_id=application.id,
        after_state={
            "department_id": str(department_id),
            "department_name": department.name,
            "designation_id": str(designation_id) if designation_id else None,
            "sanctioned": option["sanctioned"] if option else 0,
            "working": option["working"] if option else 0,
            "reserved": option["reserved"] if option else 0,
            "override_reason": reason,
        },
        request=request,
    )
