import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    DepartmentScope,
    enforce_campus_match,
    enforce_department_match,
    get_campus_scope,
    get_db,
    get_department_scope,
    require_permission,
)
from app.models.enums import PermissionEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.job_posting_channel import JobPostingChannel, PostingAttempt
from app.models.recruitment_channel import RecruitmentChannel
from app.schemas.common import PaginatedResponse
from app.schemas.job_distribution import DistributeRequest, DistributeResponse, JobAdRead
from app.schemas.job_posting_channel import (
    AttachChannelRequest,
    JobPostingChannelRead,
    ManualPostingRequest,
    PostChannelResponse,
    PostingAttemptRead,
    RecommendChannelsResponse,
    ReviewChannelRequest,
)
from app.services import job_channels, job_distribution
from app.services.n8n_client import N8nClient, get_n8n_client, get_n8n_client_or_503

router = APIRouter(prefix="/job-postings", tags=["job-distribution"])


def _distribute_gate(
    current_user: User = Depends(require_permission(PermissionEnum.JOB_DISTRIBUTION)),
) -> User:
    return current_user


def _review_gate(
    # Either permission: JOB_DISTRIBUTION holders were backfilled with
    # REVIEW_POSTING_CHANNELS (c4d5e6f7a8b9), and a Super Admin may grant the
    # narrower one alone to someone who reviews but never posts.
    current_user: User = Depends(
        require_permission(PermissionEnum.REVIEW_POSTING_CHANNELS, PermissionEnum.JOB_DISTRIBUTION)
    ),
) -> User:
    return current_user


def _get_posting_or_404_scoped(
    db: Session,
    job_posting_id: uuid.UUID,
    scope: CampusScope,
    scope_dept: DepartmentScope,
) -> JobPosting:
    posting = db.get(JobPosting, job_posting_id)
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    enforce_department_match(scope_dept, posting.department_id)
    return posting


@router.get("/{job_posting_id}/ad", response_model=JobAdRead)
def get_job_ad(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> dict:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    return job_distribution.generate_job_ad(posting)


@router.get("/{job_posting_id}/qr-code")
def get_qr_code(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> StreamingResponse:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
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
    scope_dept: DepartmentScope = Depends(get_department_scope),
    n8n_client: N8nClient = Depends(get_n8n_client_or_503),
) -> dict:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    result = job_distribution.distribute_to_portals(
        db,
        job_posting=posting,
        portals=payload.portals,
        n8n_client=n8n_client,
        actor=current_user,
        request=request,
    )
    # Commit BEFORE deciding the status code: the attempt rows and the
    # failure audit must survive a 502 (get_db never commits on exception).
    db.commit()
    if not result["ok"]:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to reach the job-distribution workflow"
        )
    return {"portals": result["portals"], "n8n_response": result.get("n8n_response")}


# --- Posting channels (2026-09-06) ------------------------------------------
# Review (select/remove) and posting share the JOB_DISTRIBUTION permission:
# they are the two halves of the act that permission already covered. A
# finer split (REVIEW_POSTING_CHANNELS) arrives with the frontend step,
# where the four permission-plumbing sites move together.


def _get_channel_row_or_404(db: Session, posting: JobPosting, channel_id: uuid.UUID) -> JobPostingChannel:
    row = (
        db.query(JobPostingChannel)
        .filter(JobPostingChannel.job_posting_id == posting.id, JobPostingChannel.channel_id == channel_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


@router.get("/{job_posting_id}/channels", response_model=PaginatedResponse[JobPostingChannelRead])
def list_posting_channels(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[JobPostingChannelRead]:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    rows = (
        db.query(JobPostingChannel)
        .join(RecruitmentChannel, RecruitmentChannel.id == JobPostingChannel.channel_id)
        .filter(JobPostingChannel.job_posting_id == posting.id)
        .order_by(RecruitmentChannel.display_order, RecruitmentChannel.code)
        .all()
    )
    return PaginatedResponse(items=rows, total=len(rows), limit=max(len(rows), 1), offset=0)


@router.post("/{job_posting_id}/channels/recommend", response_model=RecommendChannelsResponse)
def recommend_posting_channels(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> dict:
    """Re-runs the channel rules (they already ran at publish). Adds only
    channels not yet on the posting; never touches a reviewed row."""
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    if not posting.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This job posting is closed")
    created = job_channels.recommend_channels(db, job_posting=posting, actor=current_user, request=request)
    db.commit()
    for row in created:
        db.refresh(row)
    return {"created": created}


@router.post(
    "/{job_posting_id}/channels", response_model=JobPostingChannelRead, status_code=status.HTTP_201_CREATED
)
def attach_posting_channel(
    job_posting_id: uuid.UUID,
    payload: AttachChannelRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_review_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPostingChannel:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    channel = db.get(RecruitmentChannel, payload.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown channel_id")
    row = job_channels.attach_channel(db, job_posting=posting, channel=channel, actor=current_user, request=request)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{job_posting_id}/channels/{channel_id}", response_model=JobPostingChannelRead)
def review_posting_channel(
    job_posting_id: uuid.UUID,
    channel_id: uuid.UUID,
    payload: ReviewChannelRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_review_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPostingChannel:
    """The recruiter's review: SELECT a recommendation, or REMOVE a channel."""
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    row = _get_channel_row_or_404(db, posting, channel_id)
    if payload.decision == "SELECT":
        job_channels.select_channel(db, row=row, actor=current_user, request=request)
    else:
        job_channels.remove_channel(db, row=row, actor=current_user, request=request)
    db.commit()
    db.refresh(row)
    return row


@router.post("/{job_posting_id}/channels/{channel_id}/post", response_model=PostChannelResponse)
def post_posting_channel(
    job_posting_id: uuid.UUID,
    channel_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    n8n_client: N8nClient | None = Depends(get_n8n_client),
) -> dict:
    """One attempt (or retry). Always 200 with the attempt's outcome: a
    delivery failure is a recorded fact, not a request error. 409 only when
    the row must not be posted (not selected, closed posting, retry cap)."""
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    row = _get_channel_row_or_404(db, posting, channel_id)
    attempt = job_channels.post_channel(db, row=row, actor=current_user, request=request, n8n_client=n8n_client)
    db.commit()
    db.refresh(row)
    db.refresh(attempt)
    return {"channel": row, "attempt": attempt}


@router.post("/{job_posting_id}/channels/{channel_id}/manual-posting", response_model=JobPostingChannelRead)
def record_manual_posting(
    job_posting_id: uuid.UUID,
    channel_id: uuid.UUID,
    payload: ManualPostingRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_review_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPostingChannel:
    """A person posted it and is recording the portal's reference or URL."""
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    row = _get_channel_row_or_404(db, posting, channel_id)
    job_channels.record_manual_posting(
        db, row=row, actor=current_user, request=request,
        external_ref=payload.external_ref, external_url=payload.external_url,
    )
    db.commit()
    db.refresh(row)
    return row


@router.get("/{job_posting_id}/channels/{channel_id}/attempts", response_model=PaginatedResponse[PostingAttemptRead])
def list_posting_attempts(
    job_posting_id: uuid.UUID,
    channel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_distribute_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[PostingAttemptRead]:
    posting = _get_posting_or_404_scoped(db, job_posting_id, scope, scope_dept)
    row = _get_channel_row_or_404(db, posting, channel_id)
    attempts = (
        db.query(PostingAttempt)
        .filter(PostingAttempt.job_posting_channel_id == row.id)
        .order_by(PostingAttempt.attempt_number.desc())
        .all()
    )
    return PaginatedResponse(items=attempts, total=len(attempts), limit=max(len(attempts), 1), offset=0)
