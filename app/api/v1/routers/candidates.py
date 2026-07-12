import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.candidate import Candidate
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.candidate import CandidateCreate, CandidateRead
from app.schemas.common import PaginatedResponse
from app.services import storage
from app.services.audit import log_create, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/candidates", tags=["candidates"])

_MAX_RESUME_BYTES = 10 * 1024 * 1024  # 10 MB

# Candidates aren't campus-owned (a person isn't tied to one campus), so
# there's no campus scoping here -- just a staff-role gate, mirroring how
# Phase 1 handled /campuses (global read for any authenticated staff role).
_WRITE_ROLES = (UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.post("", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> Candidate:
    if db.query(Candidate).filter(Candidate.email == payload.email).one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A candidate with this email already exists")

    candidate = Candidate(
        full_name=payload.full_name,
        email=payload.email,
        phone_number=payload.phone_number,
        source=payload.source,
    )
    db.add(candidate)
    db.flush()
    log_create(
        db,
        actor=current_user,
        entity_type="Candidate",
        entity=candidate,
        campus_context_id=None,
        after_state={"full_name": candidate.full_name, "email": candidate.email},
        request=request,
    )
    db.commit()
    db.refresh(candidate)
    return candidate


@router.get("", response_model=PaginatedResponse[CandidateRead])
def list_candidates(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    email: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[CandidateRead]:
    query = db.query(Candidate)
    if email is not None:
        query = query.filter(Candidate.email.ilike(f"%{email}%"))
    total = query.count()
    rows = query.order_by(Candidate.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{candidate_id}", response_model=CandidateRead)
def get_candidate(
    candidate_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return candidate


@router.post("/{candidate_id}/resume", response_model=CandidateRead)
def upload_resume(
    candidate_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    minio_client: Minio = Depends(get_minio_client),
) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if file.content_type != "application/pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF resumes are accepted")

    data = file.file.read()
    if len(data) > _MAX_RESUME_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resume file exceeds the 10 MB limit")

    before = {"resume_storage_key": candidate.resume_storage_key}
    storage_key = storage.upload_resume(
        minio_client,
        candidate_id=candidate.id,
        filename=file.filename or "resume.pdf",
        data=data,
        content_type=file.content_type,
    )
    candidate.resume_storage_key = storage_key

    log_update(
        db,
        actor=current_user,
        entity_type="Candidate",
        entity=candidate,
        campus_context_id=None,
        before_state=before,
        after_state={"resume_storage_key": candidate.resume_storage_key},
        request=request,
    )
    db.commit()
    db.refresh(candidate)
    return candidate
