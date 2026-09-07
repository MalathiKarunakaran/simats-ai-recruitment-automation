"""Public, UNAUTHENTICATED careers pages and apply -- 2026-09-07.

Three endpoints, the same boundaries as `public_vacancy_requests.py`:

- **Reads expose the ad, not the system.** The list and detail shapes
  (`app/schemas/public_careers.py`) carry what a candidate needs and no
  internal id beyond the posting's public slug -- the same slug already
  printed on the QR poster.
- **Rate limited per IP.** Reading is loose (a candidate browses), applying
  is tight (a candidate applies once).
- **Honeypot on the write**, discarded and audited before anything is
  validated or stored, exactly as the QR form does.
- **Nothing is trusted.** The posting must be accepting applications, the
  resume must really be a PDF, the email must parse, and a second
  application from the same address to the same posting is refused.
- **An application entered here is an ordinary application** -- see
  `app/services/public_careers.py` for what that means and what it does not.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from minio import Minio
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.rate_limit import RateLimiter
from app.models.enums import StaffRoleCategoryEnum
from app.schemas.public_careers import (
    PublicApplicationConfirmation,
    PublicApplicationCreate,
    PublicJobPostingDetail,
    PublicJobPostingList,
)
from app.services import public_careers
from app.services.audit import log_event
from app.services.storage import get_minio_client

router = APIRouter(prefix="/public/careers", tags=["public"])

_read_rate_limit = RateLimiter(max_requests=60, window_seconds=60, name="public-careers-read")
_apply_rate_limit = RateLimiter(max_requests=5, window_seconds=300, name="public-careers-apply")


@router.get("/postings", response_model=PublicJobPostingList, dependencies=[Depends(_read_rate_limit)])
def list_public_postings(
    campus: str | None = Query(None, max_length=10, description="Campus code, e.g. SSE"),
    role_category: StaffRoleCategoryEnum | None = Query(None),
    q: str | None = Query(None, max_length=100, description="Matches the title"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> PublicJobPostingList:
    """Every posting currently accepting applications, newest first."""
    rows, total = public_careers.list_open_postings(
        db, campus_code=campus, role_category=role_category, q=q, limit=limit, offset=offset
    )
    return PublicJobPostingList(items=[public_careers.to_summary(row) for row in rows], total=total)


@router.get(
    "/postings/{slug}", response_model=PublicJobPostingDetail, dependencies=[Depends(_read_rate_limit)]
)
def get_public_posting(slug: str, db: Session = Depends(get_db)) -> PublicJobPostingDetail:
    """One posting by its public slug, in any state: a closed posting says so
    (`is_accepting_applications` false) rather than vanishing from under a
    printed QR code."""
    return public_careers.to_detail(public_careers.get_posting_by_slug(db, slug))


@router.post(
    "/postings/{slug}/apply",
    response_model=PublicApplicationConfirmation,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_apply_rate_limit)],
)
def apply_to_public_posting(
    slug: str,
    request: Request,
    full_name: str = Form(...),
    email: str = Form(...),
    phone_number: str | None = Form(None),
    website: str | None = Form(None),
    resume: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
) -> PublicApplicationConfirmation:
    """Apply with name, email, phone and a PDF resume. Multipart because of
    the file; the text fields are validated through `PublicApplicationCreate`
    so the rules live in one schema rather than in Form() annotations."""
    if website and website.strip():
        # Honeypot: no person sees the field. Audit it, create nothing, and
        # do not say why.
        log_event(
            db,
            actor=None,
            action="PUBLIC_APPLICATION_BLOCKED",
            entity_type="Application",
            after_state={"reason": "honeypot", "slug": slug},
            request=request,
            status_code=status.HTTP_400_BAD_REQUEST,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The application could not be processed. Please check the form and try again.",
        )

    try:
        form = PublicApplicationCreate(
            full_name=full_name.strip(),
            email=email.strip(),
            phone_number=(phone_number or "").strip() or None,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        ) from exc

    posting = public_careers.get_posting_by_slug(db, slug)

    data = resume.file.read()
    public_careers.validate_resume_pdf(content_type=resume.content_type, data=data)

    application = public_careers.apply_to_posting(
        db,
        posting=posting,
        form=form,
        resume_filename=resume.filename or "resume.pdf",
        resume_bytes=data,
        minio_client=minio_client,
        request=request,
    )
    db.commit()
    return PublicApplicationConfirmation(
        posting_number=posting.posting_number,
        title=public_careers.to_summary(posting).title,
        applicant_name=application.candidate.full_name,
        applied_at=application.applied_at,
    )
