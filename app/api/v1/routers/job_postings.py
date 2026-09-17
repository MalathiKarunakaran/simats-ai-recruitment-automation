import io
import uuid

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import settings
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
from app.schemas.job_posting import (
    JdAiStatusRead,
    JobPostingGenerateContentRequest,
    JobPostingPosterBackgroundUpdate,
    JobPostingPosterCopyUpdate,
    JobPostingRead,
    JobPostingReturnToDraftRequest,
    JobPostingUpdate,
)
from app.schemas.resume_score import RankedApplicationRead
from app.services import ai_client, job_postings, storage, vacancy_workflow
from app.services.storage import get_minio_client

router = APIRouter(prefix="/job-postings", tags=["job-postings"])

# Eager-loads for JobPostingRead's @properties -- without these, each row
# would lazy-load its approved_vacancy, vacancy_request, department,
# designation, campus, location, hiring_slots and trail users one by one.
_POSITION_TRACKING_LOADER_OPTIONS = (
    joinedload(JobPosting.approved_vacancy).joinedload(ApprovedVacancy.vacancy_request).joinedload(VacancyRequest.department),
    joinedload(JobPosting.approved_vacancy).joinedload(ApprovedVacancy.vacancy_request).joinedload(VacancyRequest.designation),
    joinedload(JobPosting.approved_vacancy).selectinload(ApprovedVacancy.hiring_slots),
    joinedload(JobPosting.campus),
    joinedload(JobPosting.location),
    selectinload(JobPosting.created_by),
    selectinload(JobPosting.last_edited_by),
    selectinload(JobPosting.submitted_for_review_by),
    selectinload(JobPosting.approved_by),
    selectinload(JobPosting.published_by),
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
    # Drafts have no published_at yet; they sort by when they were created.
    rows = (
        query.order_by(func.coalesce(JobPosting.published_at, JobPosting.created_at).desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


# Registered before /{job_posting_id}: FastAPI matches in order, and a
# literal two-segment path must not be parsed as a posting id.
@router.get("/content-generation/status", response_model=JdAiStatusRead)
def get_content_generation_status(current_user: User = Depends(_staff_only)) -> dict:
    """Whether "Generate with AI" is available, so the screen can say "not
    configured" before anyone clicks. Makes no call to the AI."""
    return ai_client.jd_ai_status()


@router.get("/poster-background/status", response_model=JdAiStatusRead)
def get_poster_background_status(current_user: User = Depends(_staff_only)) -> dict:
    """Whether a poster background can be generated, so the screen can say
    "not configured" before anyone clicks. Answers without calling the AI, and
    reports OpenAI whatever AI_PROVIDER says -- images have no Ollama
    equivalent."""
    return ai_client.image_ai_status()


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


# --- Content, review and lifecycle (2026-09-06; review 2026-09-15) -----------


def _edit_gate(
    current_user: User = Depends(require_permission(PermissionEnum.EDIT_JOB_POSTING)),
) -> User:
    return current_user


def _approve_gate(
    current_user: User = Depends(require_permission(PermissionEnum.APPROVE_JOB_POSTING)),
) -> User:
    return current_user


def _publish_gate(
    current_user: User = Depends(require_permission(PermissionEnum.PUBLISH_JOB_POSTING)),
) -> User:
    return current_user


def _return_gate(
    # The author withdrawing it, or the reviewer sending it back.
    current_user: User = Depends(
        require_permission(PermissionEnum.EDIT_JOB_POSTING, PermissionEnum.APPROVE_JOB_POSTING)
    ),
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


def _committed(db: Session, posting: JobPosting) -> JobPosting:
    db.commit()
    db.refresh(posting)
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
    return _committed(db, posting)


@router.post("/{job_posting_id}/generate-content", response_model=JobPostingRead)
def generate_job_posting_content(
    job_posting_id: uuid.UUID,
    request: Request,
    payload: JobPostingGenerateContentRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    # Last, so a caller without the permission gets 403, not 503.
    ai: openai.OpenAI = Depends(ai_client.get_jd_ai_client),
) -> JobPosting:
    """Writes an AI draft of the description into a DRAFT posting. The text
    is for a person to edit; nothing is approved, published or selected."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.generate_content(
        db,
        job_posting=posting,
        client=ai,
        provider=settings.jd_ai_provider,
        additional_instructions=payload.additional_instructions if payload else None,
        actor=current_user,
        request=request,
    )
    return _committed(db, posting)


@router.post("/{job_posting_id}/generate-poster-copy", response_model=JobPostingRead)
def generate_job_posting_poster_copy(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    # Last, so a caller without the permission gets 403, not 503.
    ai: openai.OpenAI = Depends(ai_client.get_jd_ai_client),
) -> JobPosting:
    """Writes the printed poster's wording from the advertisement's own text.
    A draft for a person to read before it reaches a notice board -- nothing
    is published and the poster download is unchanged until they are happy."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.generate_poster_copy(
        db,
        job_posting=posting,
        client=ai,
        provider=settings.jd_ai_provider,
        actor=current_user,
        request=request,
    )
    return _committed(db, posting)


@router.patch("/{job_posting_id}/poster-copy", response_model=JobPostingRead)
def update_job_posting_poster_copy(
    job_posting_id: uuid.UUID,
    payload: JobPostingPosterCopyUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    """Edits the poster wording by hand. Unlike PATCH /job-postings/{id} this
    never returns a posting under review to draft."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.update_poster_copy(
        db, job_posting=posting, changes=payload.model_dump(exclude_unset=True), actor=current_user, request=request
    )
    return _committed(db, posting)


@router.post("/{job_posting_id}/generate-poster-background", response_model=JobPostingRead)
def generate_job_posting_poster_background(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    # Last, so a caller without the permission gets 403, not 503.
    ai: openai.OpenAI = Depends(ai_client.get_image_ai_client),
    minio_client: Minio = Depends(get_minio_client),
) -> JobPosting:
    """Draws the image that sits behind the poster's header band. It is stored
    switched OFF: nothing reaches a printed poster until somebody has opened
    the preview and turned it on."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.generate_poster_background(
        db, job_posting=posting, client=ai, minio_client=minio_client, actor=current_user, request=request
    )
    return _committed(db, posting)


@router.get("/{job_posting_id}/poster-background")
def get_job_posting_poster_background(
    job_posting_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    minio_client: Minio = Depends(get_minio_client),
) -> StreamingResponse:
    """The generated image itself, for the preview a person approves from."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    if not posting.poster_background_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This job posting has no poster background"
        )
    png = storage.download_poster_background_bytes(minio_client, posting.poster_background_key)
    return StreamingResponse(io.BytesIO(png), media_type="image/png")


@router.patch("/{job_posting_id}/poster-background", response_model=JobPostingRead)
def update_job_posting_poster_background(
    job_posting_id: uuid.UUID,
    payload: JobPostingPosterBackgroundUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    """Switches the generated image on or off for printing. Like the poster
    copy this never moves the posting's own status."""
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.set_poster_background_enabled(
        db, job_posting=posting, enabled=payload.enabled, actor=current_user, request=request
    )
    return _committed(db, posting)


@router.post("/{job_posting_id}/submit-for-review", response_model=JobPostingRead)
def submit_job_posting_for_review(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_edit_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.submit_for_review(db, job_posting=posting, actor=current_user, request=request)
    return _committed(db, posting)


@router.post("/{job_posting_id}/return-to-draft", response_model=JobPostingRead)
def return_job_posting_to_draft(
    job_posting_id: uuid.UUID,
    request: Request,
    payload: JobPostingReturnToDraftRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_return_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.return_to_draft(
        db, job_posting=posting, reason=payload.reason if payload else None, actor=current_user, request=request
    )
    return _committed(db, posting)


@router.post("/{job_posting_id}/approve", response_model=JobPostingRead)
def approve_job_posting(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_approve_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.approve(db, job_posting=posting, actor=current_user, request=request)
    return _committed(db, posting)


@router.post("/{job_posting_id}/publish", response_model=JobPostingRead)
def publish_job_posting(
    job_posting_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_publish_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> JobPosting:
    posting = _get_posting_for_write(db, job_posting_id, scope, scope_dept)
    job_postings.publish(db, job_posting=posting, actor=current_user, request=request)
    return _committed(db, posting)


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
    return _committed(db, posting)


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
    return _committed(db, posting)


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
    return _committed(db, posting)
