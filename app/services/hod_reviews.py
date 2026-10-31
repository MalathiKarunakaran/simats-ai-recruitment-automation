"""HOD reviews of in-app hires on probation
(docs/specs/hod-review-and-permanent-order.md). The only writer of `HodReview`.

A review is recorded at HANDED_OVER_TO_HOD. Only RECOMMEND_PERMANENT moves
the application on, to HOD_REVIEW_COMPLETE, through
`pipeline.transition_application_status` (which refuses that move unless such
a review exists, so the row and the status travel together).
EXTEND_PROBATION needs a new probation end date and keeps the status;
NOT_RECOMMENDED keeps the status and is simply on the record -- separation
stays the existing offboarding action.
"""

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from minio import Minio
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.appointment_order import APPOINTMENT_ORDER_ISSUED, AppointmentOrder
from app.models.enums import APPLICATION_STATUS_ORDER, ApplicationStatusEnum, HodRecommendationEnum
from app.models.hod_review import HodReview
from app.models.joining import JoiningRecord
from app.models.user import User
from app.services import appointment_orders, pipeline, storage
from app.services.audit import log_create

REVIEW_FILE_DOCUMENT_TYPE_PREFIX = "HOD_REVIEW"


def list_reviews(db: Session, application: Application) -> list[HodReview]:
    """Latest first: by review date, then by when it was recorded."""
    return list(
        db.execute(
            select(HodReview)
            .where(HodReview.application_id == application.id)
            .order_by(HodReview.review_date.desc(), HodReview.recorded_at.desc())
        )
        .scalars()
        .all()
    )


def probation_end_for(
    db: Session, application: Application, reviews: list[HodReview] | None = None
) -> date | None:
    """The probation end shown everywhere: the latest "Extend probation"
    date, else the provisional order's probation end, else None (no order --
    e.g. handed over before the order step existed)."""
    reviews = list_reviews(db, application) if reviews is None else reviews
    return _probation_end(reviews, appointment_orders.current_order(db, application))


def _probation_end(reviews: list[HodReview], order: AppointmentOrder | None) -> date | None:
    for review in reviews:  # latest first
        if review.recommendation == HodRecommendationEnum.EXTEND_PROBATION.value:
            return review.new_probation_end_date
    return order.probation_end_date if order is not None else None


def probation_rows(db: Session, applications: list[Application], *, today: date) -> list[dict]:
    """The Onboarding page's per-row figures, in three queries for the whole
    list: days since joining (from the joining record, once JOINED), the
    probation end in force, the latest recommendation, and whether probation
    has ended (before today) with no "Recommend for permanent" review."""
    ids = [a.id for a in applications]
    if not ids:
        return []
    joining = {r.application_id: r for r in db.query(JoiningRecord).filter(JoiningRecord.application_id.in_(ids))}
    orders: dict = {}
    for order in (
        db.query(AppointmentOrder)
        .filter(AppointmentOrder.application_id.in_(ids), AppointmentOrder.status == APPOINTMENT_ORDER_ISSUED)
        .order_by(AppointmentOrder.issued_at)
    ):
        orders[order.application_id] = order  # latest wins, as current_order()
    reviews: dict = {}
    for review in (
        db.query(HodReview)
        .filter(HodReview.application_id.in_(ids))
        .order_by(HodReview.review_date.desc(), HodReview.recorded_at.desc())
    ):
        reviews.setdefault(review.application_id, []).append(review)

    joined_index = APPLICATION_STATUS_ORDER.index(ApplicationStatusEnum.JOINED)
    rows = []
    for application in applications:
        record = joining.get(application.id)
        joining_date = (record.actual_joining_date or record.joining_date) if record is not None else None
        joined = (
            application.status in APPLICATION_STATUS_ORDER
            and APPLICATION_STATUS_ORDER.index(application.status) >= joined_index
        )
        app_reviews = reviews.get(application.id, [])
        probation_end = _probation_end(app_reviews, orders.get(application.id))
        recommended = any(r.recommendation == HodRecommendationEnum.RECOMMEND_PERMANENT.value for r in app_reviews)
        rows.append(
            {
                "application_id": application.id,
                "status": application.status,
                "joining_date": joining_date,
                "days_since_joining": (today - joining_date).days if joined and joining_date is not None else None,
                "probation_end_date": probation_end,
                "latest_recommendation": app_reviews[0].recommendation if app_reviews else None,
                "past_probation_without_recommendation": (
                    probation_end is not None and probation_end < today and not recommended
                ),
            }
        )
    return rows


def record_review(
    db: Session,
    *,
    application: Application,
    actor: User,
    hod_name: str,
    review_date: date,
    recommendation: HodRecommendationEnum,
    new_probation_end_date: date | None = None,
    remarks: str | None = None,
    file: tuple[str, bytes, str] | None = None,
    minio_client: Minio | None = None,
    request: Request | None = None,
) -> HodReview:
    """`file` is (filename, bytes, content type), already validated by the
    caller. It is stored BEFORE the row is written (hard-fail 502 like the
    joining documents), so no row ever points at bytes that are not there."""
    if application.status != ApplicationStatusEnum.HANDED_OVER_TO_HOD:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "An HOD review can only be recorded at HANDED_OVER_TO_HOD "
                f"(this application is {application.status.value})"
            ),
        )
    hod_name = (hod_name or "").strip()
    if not hod_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="The HOD's name is required")
    if recommendation == HodRecommendationEnum.EXTEND_PROBATION:
        if new_probation_end_date is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A new probation end date is required to extend probation",
            )
    elif new_probation_end_date is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A new probation end date is only recorded when extending probation",
        )

    review = HodReview(
        id=uuid.uuid4(),
        application_id=application.id,
        campus_id=application.campus_id,
        hod_name=hod_name,
        review_date=review_date,
        recommendation=recommendation.value,
        new_probation_end_date=new_probation_end_date,
        remarks=(remarks or "").strip() or None,
        recorded_by_id=actor.id,
        recorded_at=datetime.now(timezone.utc),
    )
    if file is not None:
        filename, data, content_type = file
        review.file_key = storage.upload_joining_document(
            minio_client,
            application_id=application.id,
            document_type=f"{REVIEW_FILE_DOCUMENT_TYPE_PREFIX}_{review.id}",
            filename=filename,
            data=data,
            content_type=content_type,
        )
        review.file_content_type = content_type
        review.file_size = len(data)
    db.add(review)
    db.flush()

    log_create(
        db,
        actor=actor,
        entity_type="HodReview",
        entity=review,
        campus_context_id=application.campus_id,
        after_state={
            "application_id": str(application.id),
            "hod_name": review.hod_name,
            "review_date": review.review_date.isoformat(),
            "recommendation": review.recommendation,
            "new_probation_end_date": (
                review.new_probation_end_date.isoformat() if review.new_probation_end_date else None
            ),
            "remarks": review.remarks,
            "file_key": review.file_key,
        },
        request=request,
    )
    if recommendation == HodRecommendationEnum.RECOMMEND_PERMANENT:
        pipeline.transition_application_status(
            db,
            application=application,
            new_status=ApplicationStatusEnum.HOD_REVIEW_COMPLETE,
            actor=actor,
            request=request,
        )
    return review
