import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_db, require_permission, require_roles
from app.models.application import Application
from app.models.enums import ApplicationStatusEnum, OfferStatusEnum, PermissionEnum, UserRoleEnum
from app.models.offer import Offer
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.offer import OfferCreate, OfferDeclineRequest, OfferRead
from app.services import joining as joining_service
from app.services import notifications, pipeline
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/offers", tags=["offers"])

_WRITE_ROLES = (UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)

_NON_TERMINAL_OFFER_STATUSES = (OfferStatusEnum.DRAFT, OfferStatusEnum.SENT)


def _offer_snapshot(offer: Offer) -> dict:
    return {"status": offer.status.value, "decline_reason": offer.decline_reason}


def _get_or_404_scoped(db: Session, offer_id: uuid.UUID, scope: CampusScope) -> Offer:
    offer = db.get(Offer, offer_id)
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, offer.application.campus_id)
    return offer


@router.post("", response_model=OfferRead, status_code=status.HTTP_201_CREATED)
def create_offer(
    payload: OfferCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
) -> Offer:
    application = db.get(Application, payload.application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown application_id")

    existing_active = (
        db.query(Offer)
        .filter(Offer.application_id == application.id, Offer.status.in_(_NON_TERMINAL_OFFER_STATUSES))
        .one_or_none()
    )
    if existing_active is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This application already has an active (draft or sent) offer",
        )

    offer = Offer(
        application_id=application.id,
        offered_by_id=current_user.id,
        salary_amount=payload.salary_amount,
        salary_currency=payload.salary_currency,
        joining_date=payload.joining_date,
        terms=payload.terms,
        expires_at=payload.expires_at,
    )
    db.add(offer)
    db.flush()
    log_create(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=application.campus_id,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer


@router.get("", response_model=PaginatedResponse[OfferRead])
def list_offers(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    application_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES, UserRoleEnum.MANAGEMENT)),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[OfferRead]:
    query = db.query(Offer).join(Application, Offer.application_id == Application.id)
    if not scope.is_global:
        query = query.filter(Application.campus_id == scope.campus_id)
    if application_id is not None:
        query = query.filter(Offer.application_id == application_id)
    total = query.count()
    rows = query.order_by(Offer.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{offer_id}", response_model=OfferRead)
def get_offer(
    offer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES, UserRoleEnum.MANAGEMENT)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    return _get_or_404_scoped(db, offer_id, scope)


@router.post("/{offer_id}/send", response_model=OfferRead)
def send_offer(
    offer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    offer = _get_or_404_scoped(db, offer_id, scope)
    if offer.status != OfferStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot send from status {offer.status.value}")

    before = _offer_snapshot(offer)
    offer.status = OfferStatusEnum.SENT
    offer.sent_at = datetime.now(timezone.utc)

    pipeline.advance_if_behind(
        db, application=offer.application, target_status=ApplicationStatusEnum.OFFER_SENT, actor=current_user, request=request
    )
    log_update(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=offer.application.campus_id,
        before_state=before,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    notifications.notify(
        db,
        recipient_email=offer.application.candidate.email,
        notification_type="OFFER_SENT",
        subject="Your offer from SIMATS",
        body=f"An offer has been sent for {offer.salary_currency} {offer.salary_amount}, joining date {offer.joining_date.isoformat()}.",
        campus_context_id=offer.application.campus_id,
        related_entity_type="Offer",
        related_entity_id=offer.id,
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/accept", response_model=OfferRead)
def accept_offer(
    offer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    offer = _get_or_404_scoped(db, offer_id, scope)
    if offer.status != OfferStatusEnum.SENT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot accept from status {offer.status.value}")

    before = _offer_snapshot(offer)
    offer.status = OfferStatusEnum.ACCEPTED
    offer.responded_at = datetime.now(timezone.utc)

    application = offer.application
    pipeline.advance_if_behind(
        db, application=application, target_status=ApplicationStatusEnum.OFFER_ACCEPTED, actor=current_user, request=request
    )
    pipeline.advance_if_behind(
        db, application=application, target_status=ApplicationStatusEnum.JOINING_CONFIRMED, actor=current_user, request=request
    )
    joining_service.initialize_joining_checklist(
        db, application=application, joining_date=offer.joining_date, actor=current_user, request=request
    )

    log_update(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN},
        campus_id=application.campus_id,
        notification_type="OFFER_ACCEPTED",
        subject=f"Offer accepted: {application.candidate.full_name}",
        body=f"{application.candidate.full_name} has accepted their offer.",
        related_entity_type="Offer",
        related_entity_id=offer.id,
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/decline", response_model=OfferRead)
def decline_offer(
    offer_id: uuid.UUID,
    payload: OfferDeclineRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    offer = _get_or_404_scoped(db, offer_id, scope)
    if offer.status != OfferStatusEnum.SENT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot decline from status {offer.status.value}")

    before = _offer_snapshot(offer)
    offer.status = OfferStatusEnum.DECLINED
    offer.responded_at = datetime.now(timezone.utc)
    offer.decline_reason = payload.reason

    pipeline.transition_application_status(
        db,
        application=offer.application,
        new_status=ApplicationStatusEnum.REJECTED,
        actor=current_user,
        request=request,
        reason=f"Offer declined: {payload.reason}",
    )

    log_update(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=offer.application.campus_id,
        before_state=before,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    notifications.notify_role(
        db,
        roles={UserRoleEnum.HR_ADMIN},
        campus_id=offer.application.campus_id,
        notification_type="OFFER_DECLINED",
        subject=f"Offer declined: {offer.application.candidate.full_name}",
        body=f"{offer.application.candidate.full_name} declined their offer. Reason: {payload.reason}",
        related_entity_type="Offer",
        related_entity_id=offer.id,
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/withdraw", response_model=OfferRead)
def withdraw_offer(
    offer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    offer = _get_or_404_scoped(db, offer_id, scope)
    if offer.status != OfferStatusEnum.SENT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot withdraw from status {offer.status.value}")

    before = _offer_snapshot(offer)
    offer.status = OfferStatusEnum.WITHDRAWN
    offer.responded_at = datetime.now(timezone.utc)

    log_update(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=offer.application.campus_id,
        before_state=before,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/mark-expired", response_model=OfferRead)
def mark_offer_expired(
    offer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.OFFERS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Offer:
    offer = _get_or_404_scoped(db, offer_id, scope)
    if offer.status != OfferStatusEnum.SENT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot expire from status {offer.status.value}")

    before = _offer_snapshot(offer)
    offer.status = OfferStatusEnum.EXPIRED

    log_update(
        db,
        actor=current_user,
        entity_type="Offer",
        entity=offer,
        campus_context_id=offer.application.campus_id,
        before_state=before,
        after_state=_offer_snapshot(offer),
        request=request,
    )
    db.commit()
    db.refresh(offer)
    return offer
