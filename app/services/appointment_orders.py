"""Provisional appointment orders for in-app hires
(docs/specs/provisional-order-and-allotment.md). The only writer of
`AppointmentOrder`.

Issuing creates the order and then moves the application JOINED ->
PROVISIONAL_ORDER_ISSUED through `pipeline.transition_application_status`,
which refuses that move unless an ISSUED order exists -- so the order row
and the status always travel together.
"""

import calendar
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from minio import Minio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.appointment_order import APPOINTMENT_ORDER_ISSUED, AppointmentOrder
from app.models.campus import Campus
from app.models.enums import ApplicationStatusEnum
from app.models.joining import JoiningRecord
from app.models.user import User
from app.services import pipeline, reference_numbers, storage
from app.services.audit import log_create, log_update
from app.services.provisional_order_letter import letter_details_for

PROBATION_MONTHS = 3  # the letter's "three months"; matches the Pro App Order sheet
SIGNED_COPY_DOCUMENT_TYPE = "PROVISIONAL_ORDER_SIGNED"


def add_months(start: date, months: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def current_order(db: Session, application: Application) -> AppointmentOrder | None:
    return db.execute(
        select(AppointmentOrder)
        .where(
            AppointmentOrder.application_id == application.id,
            AppointmentOrder.status == APPOINTMENT_ORDER_ISSUED,
        )
        .order_by(AppointmentOrder.issued_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _designation_text(application: Application) -> str:
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    if vacancy_request.designation is not None:
        return vacancy_request.designation.name
    return vacancy_request.position_title


def issue_provisional_order(
    db: Session,
    *,
    application: Application,
    actor: User,
    request: Request | None = None,
    order_date: date | None = None,
) -> AppointmentOrder:
    if application.status != ApplicationStatusEnum.JOINED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A provisional order can only be issued at JOINED (this application is {application.status.value})"
            ),
        )
    if current_order(db, application) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A provisional order has already been issued"
        )

    # Serialises numbering per campus, same guard as employee codes.
    campus = db.execute(select(Campus).where(Campus.id == application.campus_id).with_for_update()).scalar_one()
    details = letter_details_for(campus.code)
    if details is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"No letter details for campus {campus.code}"
        )

    order_date = order_date or datetime.now(timezone.utc).date()
    joining_record = (
        db.query(JoiningRecord).filter(JoiningRecord.application_id == application.id).one_or_none()
    )
    joining_date = (
        (joining_record.actual_joining_date or joining_record.joining_date) if joining_record is not None else None
    )
    vacancy_request = application.job_posting.approved_vacancy.vacancy_request

    # The number is taken in the same transaction as the insert, and the
    # (campus_id, sequence) / order_number unique constraints are the
    # guarantee. A clash (only possible from something outside this path,
    # since the campus row lock serialises issuing here) is retried once on
    # a fresh number, then refused.
    order = None
    for _attempt in range(2):
        sequence, number = reference_numbers.next_provisional_order_number(
            db, campus_id=campus.id, campus_code=campus.code, printed_code=details.printed_code, order_date=order_date
        )
        candidate_order = AppointmentOrder(
            application_id=application.id,
            campus_id=campus.id,
            sequence=sequence,
            order_number=number,
            order_date=order_date,
            status=APPOINTMENT_ORDER_ISSUED,
            issued_by_id=actor.id,
            issued_at=datetime.now(timezone.utc),
            candidate_name=application.candidate.full_name,
            designation=_designation_text(application),
            category=application.role_category.value,
            campus_code=campus.code,
            college_name=details.college_name,
            principal_name=details.principal,
            # The vacancy's department: allotment happens after the order, so
            # the department allotted later can differ from the one printed.
            department_name=vacancy_request.department.name,
            joining_date=joining_date,
            probation_end_date=add_months(order_date, PROBATION_MONTHS),
        )
        savepoint = db.begin_nested()
        try:
            db.add(candidate_order)
            db.flush()
        except IntegrityError:
            savepoint.rollback()
            continue
        savepoint.commit()
        order = candidate_order
        break
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not allocate a provisional order number; please try again",
        )
    log_create(
        db,
        actor=actor,
        entity_type="AppointmentOrder",
        entity=order,
        campus_context_id=application.campus_id,
        after_state={
            "application_id": str(application.id),
            "order_number": order.order_number,
            "order_date": order.order_date.isoformat(),
            "designation": order.designation,
            "department_name": order.department_name,
            "probation_end_date": order.probation_end_date.isoformat(),
        },
        request=request,
    )
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED,
        actor=actor,
        request=request,
    )
    return order


def store_signed_copy(
    db: Session,
    *,
    order: AppointmentOrder,
    minio_client: Minio,
    filename: str,
    data: bytes,
    content_type: str,
    actor: User,
    request: Request | None = None,
) -> AppointmentOrder:
    """Stored in the joining-documents bucket like the other joining files
    (hard-fail 502 if storage is down). A re-upload replaces the copy."""
    before = {"signed_copy_key": order.signed_copy_key}
    order.signed_copy_key = storage.upload_joining_document(
        minio_client,
        application_id=order.application_id,
        document_type=SIGNED_COPY_DOCUMENT_TYPE,
        filename=filename,
        data=data,
        content_type=content_type,
    )
    order.signed_copy_content_type = content_type
    order.signed_copy_size = len(data)
    order.signed_copy_uploaded_by_id = actor.id
    order.signed_copy_uploaded_at = datetime.now(timezone.utc)
    log_update(
        db,
        actor=actor,
        entity_type="AppointmentOrder",
        entity=order,
        campus_context_id=order.campus_id,
        before_state=before,
        after_state={
            "signed_copy_key": order.signed_copy_key,
            "signed_copy_content_type": content_type,
            "signed_copy_size": len(data),
        },
        request=request,
    )
    return order
