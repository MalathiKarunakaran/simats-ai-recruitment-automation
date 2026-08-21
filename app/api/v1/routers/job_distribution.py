import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_db, require_permission
from app.models.enums import PermissionEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.schemas.job_distribution import DistributeRequest, DistributeResponse, JobAdRead
from app.services import job_distribution
from app.services.n8n_client import N8nClient, get_n8n_client_or_503

router = APIRouter(prefix="/job-postings", tags=["job-distribution"])


def _distribute_gate(
    current_user: User = Depends(require_permission(PermissionEnum.JOB_DISTRIBUTION)),
) -> User:
    return current_user


def _get_posting_or_404_scoped(db: Session, job_posting_id: uuid.UUID, scope: CampusScope) -> JobPosting:
    posting = db.get(JobPosting, job_posting_id)
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    return posting


@router.get("/{job_posting_id}/ad", response_model=JobAdRead)
def get_job_ad(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
) -> dict:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope)
    return job_distribution.generate_job_ad(posting)


@router.get("/{job_posting_id}/qr-code")
def get_qr_code(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope)
    png_bytes = job_distribution.generate_qr_code_png(posting)
    return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")


@router.post("/{job_posting_id}/distribute", response_model=DistributeResponse)
def distribute_job_posting(
    job_posting_id: uuid.UUID,
    payload: DistributeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    n8n_client: N8nClient = Depends(get_n8n_client_or_503),
) -> dict:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope)
    result = job_distribution.distribute_to_portals(
        db,
        job_posting=posting,
        portals=payload.portals,
        n8n_client=n8n_client,
        actor=current_user,
        request=request,
    )
    db.commit()
    return result
