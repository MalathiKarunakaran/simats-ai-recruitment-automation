import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.deps import (
    CampusScope,
    DepartmentScope,
    enforce_campus_match,
    enforce_department_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    get_department_scope,
    require_permission,
)
from app.models.approved_vacancy import ApprovedVacancy
from app.models.application import Application
from app.models.candidate import Candidate
from app.models.enums import PermissionEnum, UserRoleEnum
from app.models.job_posting import JobPosting
from app.models.resume_score import ResumeScore
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.schemas.common import PaginatedResponse
from app.schemas.job_posting import JobPostingRead, JobPostingUpdate
from app.services import job_postings, vacancy_workflow
from app.schemas.resume_score import RankedApplicationRead

router = APIRouter(prefix="/job-postings", tags=["job-postings"])

# Eager-loads for JobPosting's position_title/department_id/requested_count/
# available_count @properties -- without these, each row would lazy-load its
# approved_vacancy, vacancy_request, and hiring_slots individually (N+1).
_POSITION_TRACKING_LOADER_OPTIONS = (
    joinedload(JobPosting.approved_vacancy).joinedload(ApprovedVacancy.vacancy_request),
    joinedload(JobPosting.approved_vacancy).selectinload(ApprovedVacancy.hiring_slots),
)


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[JobPostingRead])
def list_job_postings(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[JobPostingRead]:
    query = db.query(JobPosting).options(*_POSITION_TRACKING_LOADER_OPTIONS)
    if not scope.is_global:
        query = query.filter(JobPosting.campus_id == scope.campus_id)
    if scope_dept.is_restricted:
        # JobPosting.department_id is a Python @property (chases
        # approved_vacancy.vacancy_request.department_id), not a column --
        # an explicit join is needed for a SQL-level filter here. Only added
        # when actually restricted, to avoid an unconditional extra join for
        # every unrestricted caller (the common case).
        query = (
            query.join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
            .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
            .filter(VacancyRequest.department_id.in_(scope_dept.department_ids))
        )
    total = query.count()
    rows = query.order_by(JobPosting.published_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{job_posting_id}", response_model=JobPostingRead)
def get_job_posting(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = (
        db.query(JobPosting)
        .options(*_POSITION_TRACKING_LOADER_OPTIONS)
        .filter(JobPosting.id == job_posting_id)
        .one_or_none()
    )
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    enforce_department_match(scope_dept, posting.department_id)
    return posting


@router.get("/{job_posting_id}/candidate-ranking", response_model=PaginatedResponse[RankedApplicationRead])
def rank_candidates(
    job_posting_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[RankedApplicationRead]:
    posting = db.get(JobPosting, job_posting_id)
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    enforce_department_match(scope_dept, posting.department_id)

    # Ranking is per-JobPosting (the applicant pool), not per-slot -- slots
    # are anonymous/interchangeable until an Application reaches SELECTED
    # (see Module 11's reservation logic), so a literal per-slot ranking
    # isn't meaningful.
    query = (
        db.query(Application, Candidate, ResumeScore)
        .join(Candidate, Application.candidate_id == Candidate.id)
        .outerjoin(ResumeScore, ResumeScore.application_id == Application.id)
        .filter(Application.job_posting_id == posting.id)
    )
    total = query.count()
    rows = (
        query.order_by(ResumeScore.overall_recruitment_score.desc().nulls_last())
        .offset(offset)
        .limit(limit)
        .all()
    )
    items = [
        RankedApplicationRead(
            application_id=application.id,
            candidate_id=candidate.id,
            candidate_full_name=candidate.full_name,
            candidate_email=candidate.email,
            application_status=application.status.value,
            overall_recruitment_score=score.overall_recruitment_score if score else None,
            eligibility_score=score.eligibility_score if score else None,
            is_duplicate=score.is_duplicate if score else False,
            is_incomplete_profile=score.is_incomplete_profile if score else False,
        )
        for application, candidate, score in rows
    ]
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


# --- Content and lifecycle (2026-09-06) --------------------------------------


def _edit_gate(
    current_user: User = Depends(require_permission(PermissionEnum.EDIT_JOB_POSTING)),
) -> User:
    return current_user


def _get_posting_for_write(
    db: Session, job_posting_id: uuid.UUID, scope: CampusScope, scope_dept: DepartmentScope
) -> JobPosting:
    posting = (
        db.query(JobPosting)
        .options(*_POSITION_TRACKING_LOADER_OPTIONS)
        .filter(JobPosting.id == job_posting_id)
        .one_or_none()
    )
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    enforce_department_match(scope_dept, posting.department_id)
    return posting


@router.patch("/{job_posting_id}", response_model=JobPostingRead)
def update_job_posting(
    job_posting_id: uuid.UUID,
    payload: JobPostingUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.update_content(
        db, job_posting=posting, changes=payload.model_dump(exclude_unset=True), actor=current_user, request=request
    )
    db.commit()
    db.refresh(posting)
    return posting


@router.post("/{job_posting_id}/pause", response_model=JobPostingRead)
def pause_job_posting(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.pause(db, job_posting=posting, actor=current_user, request=request)
    db.commit()
    db.refresh(posting)
    return posting


@router.post("/{job_posting_id}/resume", response_model=JobPostingRead)
def resume_job_posting(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.resume(db, job_posting=posting, actor=current_user, request=request)
    db.commit()
    db.refresh(posting)
    return posting


@router.post("/{job_posting_id}/close", response_model=JobPostingRead)
def close_job_posting(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    # Closing a posting closes its vacancy, so it carries the vacancy's own
    # close gate -- the same one POST /vacancy-requests/{id}/close uses.
    current_user: User = Depends(require_permission(PermissionEnum.CLOSE_VACANCY)),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    """The posting and its vacancy close together, through
    vacancy_workflow.close -- slots, request status, posting status and
    channel rows move in one transaction. There is no separate 'stop this
    ad but keep hiring': that is pause."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    approved_vacancy = posting.approved_vacancy
    vacancy_workflow.close(
        db, approved_vacancy.vacancy_request, approved_vacancy, posting, current_user, request
    )
    db.commit()
    db.refresh(posting)
    return posting
