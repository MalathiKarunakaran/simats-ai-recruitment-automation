import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_db, require_roles
from app.models.application import Application
from app.models.enums import ApplicationStatusEnum, UserRoleEnum
from app.models.joining import JoiningDocument, JoiningRecord
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.employee import EmployeeRead
from app.schemas.joining import (
    DepartmentRoomAllotmentRequest,
    HandoverToHodRequest,
    JoiningDocumentRead,
    JoiningDocumentUpdate,
    JoiningRecordRead,
    OrientationCompleteRequest,
)
from app.services import joining as joining_service
from app.services import pipeline
from app.services.audit import log_update

router = APIRouter(tags=["joining"])

_READ_ROLES = (
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.RECRUITMENT_OFFICER,
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
)
_HR_ONLY_ROLES = (UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)


def _get_application_or_404_scoped(db: Session, application_id: uuid.UUID, scope: CampusScope) -> Application:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, application.campus_id)
    return application


def _get_joining_record_or_404(db: Session, application: Application) -> JoiningRecord:
    record = db.query(JoiningRecord).filter(JoiningRecord.application_id == application.id).one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No joining record exists for this application yet (offer must be accepted first)",
        )
    return record


@router.get("/applications/{application_id}/joining-record", response_model=JoiningRecordRead)
def get_joining_record(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_READ_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> JoiningRecord:
    application = _get_application_or_404_scoped(db, application_id, scope)
    return _get_joining_record_or_404(db, application)


@router.get(
    "/applications/{application_id}/joining-documents", response_model=PaginatedResponse[JoiningDocumentRead]
)
def list_joining_documents(
    application_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_READ_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[JoiningDocumentRead]:
    application = _get_application_or_404_scoped(db, application_id, scope)
    query = db.query(JoiningDocument).filter(JoiningDocument.application_id == application.id)
    total = query.count()
    rows = query.order_by(JoiningDocument.document_type).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.patch("/joining-documents/{document_id}", response_model=JoiningDocumentRead)
def update_joining_document(
    document_id: uuid.UUID,
    payload: JoiningDocumentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_HR_ONLY_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> JoiningDocument:
    document = db.get(JoiningDocument, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, document.application.campus_id)

    before = {"status": document.status.value}
    document.status = payload.status
    if payload.storage_key is not None:
        document.storage_key = payload.storage_key
    if payload.notes is not None:
        document.notes = payload.notes
    if payload.status.value == "RECEIVED":
        document.received_at = datetime.now(timezone.utc)

    log_update(
        db,
        actor=current_user,
        entity_type="JoiningDocument",
        entity=document,
        campus_context_id=document.application.campus_id,
        before_state=before,
        after_state={"status": document.status.value},
        request=request,
    )
    db.commit()
    db.refresh(document)
    return document


@router.post("/applications/{application_id}/joining/mark-joined", response_model=JoiningRecordRead)
def mark_joined(
    application_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_READ_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> JoiningRecord:
    application = _get_application_or_404_scoped(db, application_id, scope)
    if application.status != ApplicationStatusEnum.JOINING_CONFIRMED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot mark Joined from status {application.status.value} (must be JOINING_CONFIRMED)",
        )
    joining_record = _get_joining_record_or_404(db, application)

    pipeline.transition_application_status(
        db, application=application, new_status=ApplicationStatusEnum.JOINED, actor=current_user, request=request
    )
    before = {"actual_joining_date": None}
    joining_record.actual_joining_date = datetime.now(timezone.utc).date()
    log_update(
        db,
        actor=current_user,
        entity_type="JoiningRecord",
        entity=joining_record,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state={"actual_joining_date": joining_record.actual_joining_date.isoformat()},
        request=request,
    )

    db.commit()
    db.refresh(joining_record)
    return joining_record


@router.post("/applications/{application_id}/joining/allot-department-room", response_model=JoiningRecordRead)
def allot_department_room(
    application_id: uuid.UUID,
    payload: DepartmentRoomAllotmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_HR_ONLY_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> JoiningRecord:
    application = _get_application_or_404_scoped(db, application_id, scope)
    if application.status != ApplicationStatusEnum.JOINED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot allot department/room from status {application.status.value} (must be JOINED)",
        )
    joining_record = _get_joining_record_or_404(db, application)

    # Same "documents must be received first" guard the old collapsed
    # "complete onboarding" step enforced -- still real, just gates the
    # first of the three new post-Joined stages now instead of one step.
    joining_service.complete_onboarding(
        db, application=application, joining_record=joining_record, actor=current_user, request=request
    )
    joining_service.allot_department_room(
        db,
        application=application,
        department_id=payload.department_id,
        room_allotted=payload.room_allotted,
        actor=current_user,
        request=request,
    )
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED,
        actor=current_user,
        request=request,
    )

    db.commit()
    db.refresh(joining_record)
    return joining_record


@router.post("/applications/{application_id}/joining/complete-orientation", response_model=JoiningRecordRead)
def complete_orientation(
    application_id: uuid.UUID,
    payload: OrientationCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_HR_ONLY_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> JoiningRecord:
    application = _get_application_or_404_scoped(db, application_id, scope)
    if application.status != ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot complete orientation from status {application.status.value} "
                "(must be DEPARTMENT_ROOM_ALLOTTED)"
            ),
        )
    joining_record = _get_joining_record_or_404(db, application)

    joining_service.complete_orientation(
        db,
        application=application,
        orientation_date=payload.orientation_date or datetime.now(timezone.utc).date(),
        actor=current_user,
        request=request,
    )
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=ApplicationStatusEnum.ORIENTATION_COMPLETE,
        actor=current_user,
        request=request,
    )

    db.commit()
    db.refresh(joining_record)
    return joining_record


@router.post("/applications/{application_id}/joining/hand-over-to-hod", response_model=EmployeeRead)
def hand_over_to_hod(
    application_id: uuid.UUID,
    payload: HandoverToHodRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_HR_ONLY_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
):
    application = _get_application_or_404_scoped(db, application_id, scope)
    if application.status != ApplicationStatusEnum.ORIENTATION_COMPLETE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot hand over to HOD from status {application.status.value} (must be ORIENTATION_COMPLETE)"
            ),
        )
    joining_record = _get_joining_record_or_404(db, application)

    before = {"hod_assigned": application.hod_assigned}
    application.hod_assigned = payload.hod_assigned
    log_update(
        db,
        actor=current_user,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state={"hod_assigned": payload.hod_assigned},
        request=request,
    )

    employee = joining_service.create_employee(
        db,
        application=application,
        joining_record=joining_record,
        designation=payload.designation,
        actor=current_user,
        request=request,
    )
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=ApplicationStatusEnum.HANDED_OVER_TO_HOD,
        actor=current_user,
        request=request,
    )

    db.commit()
    db.refresh(employee)
    return employee
