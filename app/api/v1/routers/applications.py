import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_roles,
)
from app.models.application import Application
from app.models.candidate import Candidate
from app.models.enums import ApplicationStatusEnum, UserRoleEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.schemas.application import (
    ApplicationCreate,
    ApplicationPipelineDetailsUpdate,
    ApplicationRead,
    ApplicationStatusTransitionRequest,
)
from app.schemas.common import PaginatedResponse
from app.services import pipeline
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/applications", tags=["applications"])

_WRITE_ROLES = (UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_or_404_scoped(db: Session, application_id: uuid.UUID, scope: CampusScope) -> Application:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, application.campus_id)
    return application


@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def create_application(
    payload: ApplicationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> Application:
    candidate = db.get(Candidate, payload.candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown candidate_id")

    job_posting = db.get(JobPosting, payload.job_posting_id)
    if job_posting is None or not job_posting.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or closed job_posting_id")

    if current_user.role == UserRoleEnum.RECRUITMENT_OFFICER and job_posting.campus_id != current_user.campus_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Recruitment Officers may only record applications for their own campus's postings",
        )

    if (
        db.query(Application)
        .filter(Application.candidate_id == candidate.id, Application.job_posting_id == job_posting.id)
        .one_or_none()
        is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This candidate has already applied to this posting"
        )

    application = Application(
        candidate_id=candidate.id,
        job_posting_id=job_posting.id,
        campus_id=job_posting.campus_id,
        applied_at=datetime.now(timezone.utc),
        recorded_by_id=current_user.id,
    )
    db.add(application)
    db.flush()
    log_create(
        db,
        actor=current_user,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        after_state={"status": application.status.value},
        request=request,
    )
    db.commit()
    db.refresh(application)
    return application


@router.get("", response_model=PaginatedResponse[ApplicationRead])
def list_applications(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status_filter: ApplicationStatusEnum | None = Query(None, alias="status"),
    candidate_id: uuid.UUID | None = Query(None),
    job_posting_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[ApplicationRead]:
    query = db.query(Application)
    if not scope.is_global:
        query = query.filter(Application.campus_id == scope.campus_id)
    if status_filter is not None:
        query = query.filter(Application.status == status_filter)
    if candidate_id is not None:
        query = query.filter(Application.candidate_id == candidate_id)
    if job_posting_id is not None:
        query = query.filter(Application.job_posting_id == job_posting_id)
    total = query.count()
    rows = query.order_by(Application.applied_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> Application:
    return _get_or_404_scoped(db, application_id, scope)


@router.patch("/{application_id}/pipeline-details", response_model=ApplicationRead)
def update_pipeline_details(
    application_id: uuid.UUID,
    payload: ApplicationPipelineDetailsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Application:
    """Record-keeping fields for the real manual workflow (panel members/
    result/remarks, salary fixed, key dates) -- a plain field update, not a
    status transition. Used by the tracker-workbook importer and by HR
    manually noting these in the UI."""
    application = _get_or_404_scoped(db, application_id, scope)
    updates = payload.model_dump(exclude_unset=True)
    before = {field: getattr(application, field) for field in updates}
    for field, value in updates.items():
        setattr(application, field, value)
    log_update(
        db,
        actor=current_user,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        before_state=before,
        after_state=updates,
        request=request,
    )
    db.commit()
    db.refresh(application)
    return application


@router.patch("/{application_id}/status", response_model=ApplicationRead)
def transition_application_status(
    application_id: uuid.UUID,
    payload: ApplicationStatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Application:
    application = _get_or_404_scoped(db, application_id, scope)
    pipeline.transition_application_status(
        db,
        application=application,
        new_status=payload.status,
        actor=current_user,
        request=request,
        reason=payload.reason,
        force=payload.force,
    )
    db.commit()
    db.refresh(application)
    return application
