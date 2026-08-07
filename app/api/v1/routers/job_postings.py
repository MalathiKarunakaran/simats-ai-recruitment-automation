import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db
from app.models.approved_vacancy import ApprovedVacancy
from app.models.application import Application
from app.models.candidate import Candidate
from app.models.enums import UserRoleEnum
from app.models.job_posting import JobPosting
from app.models.resume_score import ResumeScore
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.job_posting import JobPostingRead
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
) -> PaginatedResponse[JobPostingRead]:
    query = db.query(JobPosting).options(*_POSITION_TRACKING_LOADER_OPTIONS)
    if not scope.is_global:
        query = query.filter(JobPosting.campus_id == scope.campus_id)
    total = query.count()
    rows = query.order_by(JobPosting.published_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{job_posting_id}", response_model=JobPostingRead)
def get_job_posting(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
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
    return posting


@router.get("/{job_posting_id}/candidate-ranking", response_model=PaginatedResponse[RankedApplicationRead])
def rank_candidates(
    job_posting_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[RankedApplicationRead]:
    posting = db.get(JobPosting, job_posting_id)
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)

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
