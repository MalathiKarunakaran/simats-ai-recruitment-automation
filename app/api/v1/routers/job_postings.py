import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db
from app.models.enums import UserRoleEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.job_posting import JobPostingRead

router = APIRouter(prefix="/job-postings", tags=["job-postings"])


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
    query = db.query(JobPosting)
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
    posting = db.get(JobPosting, job_posting_id)
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    return posting
