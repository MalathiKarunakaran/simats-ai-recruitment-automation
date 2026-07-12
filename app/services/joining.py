"""Module 10: joining checklist initialization, onboarding completion, and
employee record creation."""

from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.campus import Campus
from app.models.employee import Employee
from app.models.enums import DEFAULT_JOINING_DOCUMENT_TYPES, JoiningDocumentStatusEnum
from app.models.joining import JoiningDocument, JoiningRecord
from app.models.user import User
from app.services.audit import log_create


def initialize_joining_checklist(
    db: Session,
    *,
    application: Application,
    joining_date: date,
    actor: User,
    request: Request | None = None,
) -> JoiningRecord:
    record = JoiningRecord(application_id=application.id, joining_date=joining_date)
    db.add(record)
    db.flush()

    for document_type in DEFAULT_JOINING_DOCUMENT_TYPES:
        db.add(JoiningDocument(application_id=application.id, document_type=document_type))

    log_create(
        db,
        actor=actor,
        entity_type="JoiningRecord",
        entity=record,
        campus_context_id=application.campus_id,
        after_state={"joining_date": joining_date.isoformat()},
        request=request,
    )
    return record


def complete_onboarding(
    db: Session,
    *,
    application: Application,
    joining_record: JoiningRecord,
    actor: User,
    request: Request | None = None,
) -> JoiningRecord:
    pending = (
        db.execute(
            select(JoiningDocument).where(
                JoiningDocument.application_id == application.id,
                JoiningDocument.status == JoiningDocumentStatusEnum.PENDING,
            )
        )
        .scalars()
        .all()
    )
    if pending:
        pending_types = ", ".join(sorted(d.document_type for d in pending))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot complete onboarding -- documents still pending: {pending_types}",
        )

    joining_record.onboarding_completed_at = datetime.now(timezone.utc)
    joining_record.onboarding_completed_by_id = actor.id
    return joining_record


def _generate_employee_code(db: Session, campus: Campus) -> str:
    # Row-locks the campus itself as a simple, correct concurrency guard for
    # per-campus sequence generation -- Phase 2 doesn't have a dedicated
    # sequence table, and campuses are a small, rarely-contended row set.
    db.execute(select(Campus).where(Campus.id == campus.id).with_for_update())
    existing_count = db.execute(
        select(func.count()).select_from(Employee).where(Employee.campus_id == campus.id)
    ).scalar_one()
    return f"{campus.code}-{existing_count + 1:04d}"


def create_employee(
    db: Session,
    *,
    application: Application,
    joining_record: JoiningRecord,
    designation: str | None,
    actor: User,
    request: Request | None = None,
) -> Employee:
    campus = application.campus
    candidate = application.candidate
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request

    employee = Employee(
        application_id=application.id,
        employee_code=_generate_employee_code(db, campus),
        campus_id=campus.id,
        department_id=vacancy_request.department_id,
        full_name=candidate.full_name,
        email=candidate.email,
        phone_number=candidate.phone_number,
        designation=designation or vacancy_request.position_title,
        date_of_joining=joining_record.actual_joining_date or joining_record.joining_date,
    )
    db.add(employee)
    db.flush()

    log_create(
        db,
        actor=actor,
        entity_type="Employee",
        entity=employee,
        campus_context_id=campus.id,
        after_state={"employee_code": employee.employee_code, "designation": employee.designation},
        request=request,
    )
    return employee
