import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_roles, require_roles_or_coordinator_capability
from app.models.candidate import Candidate
from app.models.enums import CoordinatorCapabilityEnum, UserRoleEnum
from app.models.user import User
from app.schemas.candidate import CandidateCreate, CandidateRead, CandidateUpdate, CandidateWithdrawRequest
from app.schemas.common import PaginatedResponse
from app.services import candidates as candidates_service
from app.services import storage
from app.services.audit import log_create, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/candidates", tags=["candidates"])

_MAX_RESUME_BYTES = 10 * 1024 * 1024  # 10 MB

# Candidates aren't campus-owned (a person isn't tied to one campus), so
# there's no campus scoping here -- just a staff-role gate, mirroring how
# Phase 1 handled /campuses (global read for any authenticated staff role).
# RECRUITMENT_COORDINATOR's membership is additionally conditional on a
# CANDIDATES_APPLICATIONS capability grant -- see require_roles_or_coordinator_capability.
_WRITE_ROLES = (UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)


def _write_gate(
    current_user: User = Depends(
        require_roles_or_coordinator_capability(CoordinatorCapabilityEnum.CANDIDATES_APPLICATIONS, *_WRITE_ROLES)
    ),
) -> User:
    return current_user


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.post("", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> Candidate:
    if db.query(Candidate).filter(Candidate.email == payload.email).one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A candidate with this email already exists")

    candidate = Candidate(
        full_name=payload.full_name,
        email=payload.email,
        phone_number=payload.phone_number,
        source=payload.source,
        reference_name=payload.reference_name,
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
    is_withdrawn: bool | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[CandidateRead]:
    query = db.query(Candidate)
    if email is not None:
        query = query.filter(Candidate.email.ilike(f"%{email}%"))
    if is_withdrawn is not None:
        query = query.filter(Candidate.is_withdrawn == is_withdrawn)
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


@router.patch("/{candidate_id}", response_model=CandidateRead)
def update_candidate(
    candidate_id: uuid.UUID,
    payload: CandidateUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = {
        "full_name": candidate.full_name,
        "email": candidate.email,
        "phone_number": candidate.phone_number,
        "source": candidate.source,
        "reference_name": candidate.reference_name,
    }

    updates = payload.model_dump(exclude_unset=True)

    if "email" in updates and updates["email"] != candidate.email:
        duplicate = (
            db.query(Candidate)
            .filter(Candidate.email == updates["email"], Candidate.id != candidate.id)
            .one_or_none()
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="A candidate with this email already exists"
            )

    for field, value in updates.items():
        setattr(candidate, field, value)

    # Same reference_name-required-for-Reference-source rule CandidateCreate
    # enforces (app/schemas/candidate.py's model_validator) -- re-checked
    # here against the *merged* state so a PATCH that only flips source to
    # "Reference" while leaving reference_name unset still gets caught, even
    # though this schema's own validator can't see the candidate's prior row.
    if candidate.source == "Reference" and not candidate.reference_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reference_name is required when source is 'Reference'",
        )

    log_update(
        db,
        actor=current_user,
        entity_type="Candidate",
        entity=candidate,
        campus_context_id=None,
        before_state=before,
        after_state={
            "full_name": candidate.full_name,
            "email": candidate.email,
            "phone_number": candidate.phone_number,
            "source": candidate.source,
            "reference_name": candidate.reference_name,
        },
        request=request,
    )
    db.commit()
    db.refresh(candidate)
    return candidate


@router.post("/{candidate_id}/withdraw", response_model=CandidateRead)
def withdraw_candidate(
    candidate_id: uuid.UUID,
    payload: CandidateWithdrawRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    candidates_service.withdraw_candidate(
        db,
        candidate=candidate,
        reason=payload.reason,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(candidate)
    return candidate


@router.post("/{candidate_id}/resume", response_model=CandidateRead)
def upload_resume(
    candidate_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
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

    # Defense in depth on top of the content-type check above -- a client's
    # Content-Type header is trivially spoofable, so confirm the bytes
    # actually parse as a PDF before accepting the upload.
    try:
        PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is not a valid PDF") from exc

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


@router.get("/{candidate_id}/resume")
def download_resume(
    candidate_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    minio_client: Minio = Depends(get_minio_client),
) -> StreamingResponse:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None or candidate.resume_storage_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    data = storage.download_resume_bytes(minio_client, candidate.resume_storage_key)
    filename = candidate.resume_storage_key.rsplit("/", 1)[-1]
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
