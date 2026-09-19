"""Campaign posters: one A4 sheet advertising several open positions.

Its own resource, not a sub-resource of a job posting, for two reasons. A
campaign covers several postings and belongs to none of them -- and
`/job-postings/{job_posting_id}` is registered first, so any literal path
beside it is read as a posting id and answered with a 422 about an invalid
UUID. The mistake is silent and the error message points nowhere near the
cause, so the resource that is genuinely separate gets a separate prefix.
"""

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from minio import Minio
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
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
from app.models.enums import JobPostingStatusEnum, PermissionEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.services import campaign_poster, campus_identity, job_distribution, storage
from app.services.storage import get_minio_client

router = APIRouter(prefix="/campaign-posters", tags=["campaign-posters"])


def _poster_gate(
    current_user: User = Depends(require_permission(PermissionEnum.JOB_DISTRIBUTION)),
) -> User:
    """The same permission that prints the single-posting poster."""
    return current_user


def _get_posting_or_404_scoped(
    db: Session, job_posting_id: uuid.UUID, scope: CampusScope, scope_dept: DepartmentScope
) -> JobPosting:
    posting = db.query(JobPosting).filter(JobPosting.id == job_posting_id).one_or_none()
    if posting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, posting.campus_id)
    enforce_department_match(scope_dept, posting.department_id)
    return posting


def _parse_posting_ids(raw: str) -> list[uuid.UUID]:
    """At most six roles: beyond that the sheet stops being readable across a
    corridor, which is the only thing a notice-board poster has to do."""
    ids: list[uuid.UUID] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            parsed = uuid.UUID(chunk)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Not a job posting id: {chunk}"
            ) from None
        if parsed not in ids:
            ids.append(parsed)
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Name at least one job posting for the poster."
        )
    if len(ids) > 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="A poster can advertise at most six positions."
        )
    return ids


def apply_url_for(postings) -> str:
    """Where the QR code sends a reader.

    One posting: its own public page. Several: the careers list, because no
    single posting's page advertises the others -- a sheet offering three
    roles whose QR opens only the electrician's is quietly wrong.

    Public (not underscored) because it carries the decision this poster is
    judged on, and the QR encodes it into vector modules rather than leaving
    the string anywhere in the PDF for a test to read back.
    """
    if len(postings) == 1:
        return job_distribution.build_public_apply_url(postings[0])
    return f"{settings.public_apply_base_url}/careers"


def _read_identity_asset(identity, name: str) -> bytes | None:
    """The campus's own artwork, when it has been supplied. Missing files are
    not an error: campaign_poster draws a labelled placeholder instead, so the
    sheet still prints while the logo and photograph are being collected."""
    path = identity.asset_path(name)
    return path.read_bytes() if path else None


@router.get("")
def get_campaign_poster(
    posting_ids: str = Query(..., description="Comma-separated job posting ids, all from one campus"),
    title: str = Query("We are hiring", max_length=60, description="The ribbon: 'Join our maintenance team'"),
    pitch: str | None = Query(None, max_length=160),
    db: Session = Depends(get_db),
    current_user: User = Depends(_poster_gate),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
    minio_client: Minio = Depends(get_minio_client),
) -> StreamingResponse:
    """One A4 sheet advertising several open positions, in the campus's own
    house style -- the poster that actually goes on a notice board.

    Every posting must be PUBLISHED and from the same campus: the
    sheet carries one campus's logo, address and QR code, so mixing campuses
    would advertise the wrong place to apply.
    """
    ids = _parse_posting_ids(posting_ids)
    postings = [_get_posting_or_404_scoped(db, posting_id, scope, scope_dept) for posting_id in ids]

    for posting in postings:
        if posting.status != JobPostingStatusEnum.PUBLISHED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{posting.posting_number or 'A job posting'} is not published: a poster's QR code "
                    "opens the public apply page."
                ),
            )
    if len({posting.campus_id for posting in postings}) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All the job postings on one poster must belong to the same campus.",
        )

    identity = campus_identity.identity_for(postings[0].campus)
    apply_url = apply_url_for(postings)
    # Only a photo a person has switched on is printed, and only if storage
    # answers: an unreachable MinIO costs the pictures, not the poster.
    role_artwork = {
        posting.id: storage.try_download_poster_artwork_bytes(minio_client, posting.role_photo_key)
        for posting in postings
        if posting.role_photo_enabled and posting.role_photo_key
    }
    content = campaign_poster.campaign_poster_content(
        postings,
        identity=identity,
        role_artwork=role_artwork,
        ribbon_title=title,
        apply_url=apply_url,
        pitch=pitch,
        campus_png=_read_identity_asset(identity, "campus.jpg"),
        logo_png=_read_identity_asset(identity, "logo.png"),
        seal_png=_read_identity_asset(identity, "seal.png"),
    )
    pdf_bytes = campaign_poster.render_campaign_poster_pdf(content)
    filename = f"{identity.code.lower()}-campaign-poster.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


