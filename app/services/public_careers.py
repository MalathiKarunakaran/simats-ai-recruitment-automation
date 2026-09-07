"""Public careers pages and the candidate apply flow -- 2026-09-07.

The second unauthenticated write surface after the QR vacancy-request intake
(`vacancy_request_intake.py`), and built on the same footing:

- **What is listed is decided by the posting's own lifecycle only.**
  PUBLISHED and not past `apply_deadline`, i.e. `JobPosting.
  is_accepting_applications`. It is deliberately NOT tied to the posting's
  CAREERS_PAGE channel row (`job_channels.py`): that row is bookkeeping about
  where a posting has been put, and making visibility depend on it would have
  hidden every posting published before channels existed until someone
  clicked through the channels panel. Pausing the posting is how HR hides it.
- **A public application is a normal application.** It is created the same
  way `applications.create_application` creates one -- same duplicate rule,
  same non-blocking qualification check, same audit -- and enters the
  pipeline at APPLIED, so nothing downstream can tell the difference except
  the candidate's `source`. Screening stays a staff action: an OpenAI call and
  a vector-store write on an unauthenticated endpoint is not a trade worth
  making for convenience.
- **The row needs an owner.** `Application.recorded_by_id` is NOT NULL, so
  the application is attributed to the same intake account the QR form uses
  (`vacancy_request_intake.resolve_intake_user`). The person is the
  `Candidate` row; the account only says which surface recorded it.
- **The candidate is found or created by email**, case-insensitively, so a
  person applying to two postings is one candidate with two applications
  (which is what the duplicate detector and the ranking expect), and a
  candidate HR already entered by hand is not duplicated when they later
  apply online. The uploaded resume replaces whatever was there: the newest
  resume is the one they want screened.
"""

import io
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request, status
from minio import Minio
from pypdf import PdfReader
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.enums import JobPostingStatusEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.job_posting import JobPosting
from app.models.vacancy_request import VacancyRequest
from app.schemas.candidate import CAREERS_PAGE_SOURCE
from app.schemas.public_careers import (
    PublicApplicationCreate,
    PublicJobPostingDetail,
    PublicJobPostingSummary,
)
from app.services import eligibility, storage
from app.services.audit import log_create, log_update
from app.services.job_postings import default_ad_body
from app.services.notifications import notify_role
from app.services.vacancy_request_intake import resolve_intake_user

MAX_RESUME_BYTES = 10 * 1024 * 1024  # 10 MB, same as the staff upload
APPLICATION_RECEIVED_NOTIFICATION = "APPLICATION_RECEIVED"


def _accepting_filter():
    """SQL form of `JobPosting.is_accepting_applications`, for the list."""
    return (
        JobPosting.status == JobPostingStatusEnum.PUBLISHED,
        or_(JobPosting.apply_deadline.is_(None), JobPosting.apply_deadline >= date.today()),
    )


def _base_query(db: Session):
    return (
        db.query(JobPosting)
        .join(JobPosting.approved_vacancy)
        .join(ApprovedVacancy.vacancy_request)
        .join(JobPosting.campus)
        .options(
            joinedload(JobPosting.campus),
            joinedload(JobPosting.approved_vacancy)
            .joinedload(ApprovedVacancy.vacancy_request)
            .joinedload(VacancyRequest.department),
            joinedload(JobPosting.approved_vacancy).joinedload(ApprovedVacancy.hiring_slots),
        )
    )


def list_open_postings(
    db: Session,
    *,
    campus_code: str | None,
    role_category: StaffRoleCategoryEnum | None,
    q: str | None,
    limit: int,
    offset: int,
) -> tuple[list[JobPosting], int]:
    query = _base_query(db).filter(*_accepting_filter())
    if campus_code:
        query = query.filter(func.upper(Campus.code) == campus_code.strip().upper())
    if role_category is not None:
        query = query.filter(JobPosting.role_category == role_category)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        query = query.filter(
            or_(JobPosting.ad_title.ilike(needle), VacancyRequest.position_title.ilike(needle))
        )
    total = query.count()
    rows = query.order_by(JobPosting.published_at.desc()).offset(offset).limit(limit).all()
    return rows, total


def get_posting_by_slug(db: Session, slug: str) -> JobPosting:
    """Any posting the slug names, whatever its state -- the detail page says
    "closed" itself. 404 only for a slug that never existed."""
    posting = _base_query(db).filter(JobPosting.public_apply_slug == slug).one_or_none()
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return posting


def _title(posting: JobPosting) -> str:
    return posting.ad_title or posting.approved_vacancy.vacancy_request.position_title


def to_summary(posting: JobPosting) -> PublicJobPostingSummary:
    vacancy_request = posting.approved_vacancy.vacancy_request
    return PublicJobPostingSummary(
        posting_number=posting.posting_number,
        public_apply_slug=posting.public_apply_slug,
        title=_title(posting),
        campus_code=posting.campus.code,
        campus_name=posting.campus.name,
        department_name=vacancy_request.department.name,
        role_category=posting.role_category,
        employment_type=vacancy_request.employment_type.value,
        qualification=vacancy_request.qualification,
        experience_required=vacancy_request.experience_required,
        positions_open=posting.requested_count,
        apply_deadline=posting.apply_deadline,
        published_at=posting.published_at,
    )


def to_detail(posting: JobPosting) -> PublicJobPostingDetail:
    vacancy_request = posting.approved_vacancy.vacancy_request
    return PublicJobPostingDetail(
        **to_summary(posting).model_dump(),
        ad_body=posting.ad_body or vacancy_request.jd_draft or default_ad_body(vacancy_request),
        contact_email=posting.contact_email,
        status=posting.status,
        is_accepting_applications=posting.is_accepting_applications,
    )


def validate_resume_pdf(*, content_type: str | None, data: bytes) -> None:
    """The staff upload's checks (`candidates.upload_resume`), verbatim: the
    declared type, the size cap, and that the bytes really parse as a PDF."""
    if content_type != "application/pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF resumes are accepted")
    if len(data) > MAX_RESUME_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resume file exceeds the 10 MB limit")
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resume file is empty")
    try:
        PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is not a valid PDF") from exc


def _find_or_create_candidate(
    db: Session, *, form: PublicApplicationCreate, actor, request: Request | None
) -> Candidate:
    email = str(form.email).strip().lower()
    candidate = db.query(Candidate).filter(func.lower(Candidate.email) == email).one_or_none()
    if candidate is not None:
        # Fill in what HR did not have; never overwrite what they did. A
        # phone number typed on the apply form is fresher than a blank.
        if form.phone_number and not candidate.phone_number:
            before = {"phone_number": candidate.phone_number}
            candidate.phone_number = form.phone_number.strip()
            log_update(
                db,
                actor=actor,
                entity_type="Candidate",
                entity=candidate,
                campus_context_id=None,
                before_state=before,
                after_state={"phone_number": candidate.phone_number},
                request=request,
            )
        return candidate

    candidate = Candidate(
        full_name=form.full_name.strip(),
        email=email,
        phone_number=form.phone_number.strip() if form.phone_number else None,
        source=CAREERS_PAGE_SOURCE,
    )
    db.add(candidate)
    db.flush()
    log_create(
        db,
        actor=actor,
        entity_type="Candidate",
        entity=candidate,
        campus_context_id=None,
        after_state={"full_name": candidate.full_name, "email": candidate.email, "source": candidate.source},
        request=request,
    )
    return candidate


def apply_to_posting(
    db: Session,
    *,
    posting: JobPosting,
    form: PublicApplicationCreate,
    resume_filename: str,
    resume_bytes: bytes,
    minio_client: Minio,
    request: Request | None,
) -> Application:
    """Create the candidate (if new), store the resume, record the
    application, tell the campus's recruiters. Commits nothing -- the router
    does, so a storage failure after the rows are staged rolls everything
    back together."""
    if not posting.is_accepting_applications:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This posting is no longer accepting applications"
        )

    actor = resolve_intake_user(db)
    candidate = _find_or_create_candidate(db, form=form, actor=actor, request=request)

    already = (
        db.query(Application)
        .filter(Application.candidate_id == candidate.id, Application.job_posting_id == posting.id)
        .one_or_none()
    )
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An application from this email address already exists for this posting",
        )

    # Storage before the application row: `upload_resume` raises 502 on a
    # storage failure, and an application whose resume never landed would be
    # unscreenable -- better that the applicant sees the failure and retries.
    before = {"resume_storage_key": candidate.resume_storage_key}
    candidate.resume_storage_key = storage.upload_resume(
        minio_client,
        candidate_id=candidate.id,
        filename=resume_filename,
        data=resume_bytes,
        content_type="application/pdf",
    )
    if before["resume_storage_key"] != candidate.resume_storage_key:
        log_update(
            db,
            actor=actor,
            entity_type="Candidate",
            entity=candidate,
            campus_context_id=None,
            before_state=before,
            after_state={"resume_storage_key": candidate.resume_storage_key},
            request=request,
        )

    vacancy_request = posting.approved_vacancy.vacancy_request
    qualification_mismatch, qualification_mismatch_reason = eligibility.check_qualification_mismatch(
        db,
        campus_id=posting.campus_id,
        role_category=vacancy_request.role_category,
        position_title=vacancy_request.position_title,
        qualification_text=vacancy_request.qualification,
    )

    application = Application(
        candidate_id=candidate.id,
        job_posting_id=posting.id,
        campus_id=posting.campus_id,
        role_category=posting.role_category,
        applied_at=datetime.now(timezone.utc),
        recorded_by_id=actor.id,
        qualification_mismatch=qualification_mismatch,
        qualification_mismatch_reason=qualification_mismatch_reason,
    )
    db.add(application)
    db.flush()
    log_create(
        db,
        actor=actor,
        entity_type="Application",
        entity=application,
        campus_context_id=application.campus_id,
        after_state={
            "status": application.status.value,
            "source": CAREERS_PAGE_SOURCE,
            "qualification_mismatch": application.qualification_mismatch,
            "qualification_mismatch_reason": application.qualification_mismatch_reason,
        },
        request=request,
    )

    notify_role(
        db,
        roles={UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.HR_ADMIN},
        campus_id=posting.campus_id,
        notification_type=APPLICATION_RECEIVED_NOTIFICATION,
        subject=f"New application: {_title(posting)}",
        body=(
            f"{candidate.full_name} applied online for {_title(posting)} "
            f"({posting.posting_number or posting.public_apply_slug}) at {posting.campus.code}."
        ),
        related_entity_type="Application",
        related_entity_id=application.id,
        request=request,
    )
    return application
