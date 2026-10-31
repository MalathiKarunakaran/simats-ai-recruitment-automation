"""Permanent appointment orders for in-app hires
(docs/specs/hod-review-and-permanent-order.md). The only writer of
`PermanentOrder`.

The Registrar's office issues the order; this records it and moves the
application HOD_REVIEW_COMPLETE -> PERMANENT_ORDER_ISSUED through
`pipeline.transition_application_status`, which refuses that move unless the
row exists. No letter is generated.
"""

from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from minio import Minio
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.enums import ApplicationStatusEnum
from app.models.permanent_order import PermanentOrder
from app.models.user import User
from app.services import pipeline, storage
from app.services.audit import log_create, log_update

SIGNED_ORDER_DOCUMENT_TYPE = "PERMANENT_ORDER_SIGNED"


def get_order(db: Session, application: Application) -> PermanentOrder | None:
    return db.execute(
        select(PermanentOrder).where(PermanentOrder.application_id == application.id)
    ).scalar_one_or_none()


def record_order(
    db: Session,
    *,
    application: Application,
    actor: User,
    registrar_ref_no: str,
    order_date: date,
    issued_to_faculty_on: date,
    request: Request | None = None,
) -> PermanentOrder:
    if application.status != ApplicationStatusEnum.HOD_REVIEW_COMPLETE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A permanent order can only be recorded at HOD_REVIEW_COMPLETE "
                f"(this application is {application.status.value})"
            ),
        )
    if get_order(db, application) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A permanent order is already recorded")
    registrar_ref_no = (registrar_ref_no or "").strip()
    if not registrar_ref_no:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="The Registrar's reference number is required"
        )
    if issued_to_faculty_on < order_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The order cannot be issued to the faculty member before its order date",
        )

    order = PermanentOrder(
        application_id=application.id,
        campus_id=application.campus_id,
        registrar_ref_no=registrar_ref_no,
        order_date=order_date,
        issued_to_faculty_on=issued_to_faculty_on,
        recorded_by_id=actor.id,
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(order)
    db.flush()
    log_create(
        db,
        actor=actor,
        entity_type="PermanentOrder",
        entity=order,
        campus_context_id=application.campus_id,
        after_state={
            "application_id": str(application.id),
            "registrar_ref_no": order.registrar_ref_no,
            "order_date": order.order_date.isoformat(),
            "issued_to_faculty_on": order.issued_to_faculty_on.isoformat(),
        },
        request=request,
    )
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=ApplicationStatusEnum.PERMANENT_ORDER_ISSUED,
        actor=actor,
        request=request,
    )
    return order


def store_signed_order(
    db: Session,
    *,
    order: PermanentOrder,
    minio_client: Minio,
    filename: str,
    data: bytes,
    content_type: str,
    actor: User,
    request: Request | None = None,
) -> PermanentOrder:
    """Stored in the joining-documents bucket (hard-fail 502 if storage is
    down). A re-upload replaces the file."""
    before = {"file_key": order.file_key}
    order.file_key = storage.upload_joining_document(
        minio_client,
        application_id=order.application_id,
        document_type=SIGNED_ORDER_DOCUMENT_TYPE,
        filename=filename,
        data=data,
        content_type=content_type,
    )
    order.file_content_type = content_type
    order.file_size = len(data)
    order.file_uploaded_by_id = actor.id
    order.file_uploaded_at = datetime.now(timezone.utc)
    log_update(
        db,
        actor=actor,
        entity_type="PermanentOrder",
        entity=order,
        campus_context_id=order.campus_id,
        before_state=before,
        after_state={"file_key": order.file_key, "file_content_type": content_type, "file_size": len(data)},
        request=request,
    )
    return order
