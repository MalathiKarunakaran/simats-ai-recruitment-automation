"""Recruitment mail intake (2026-10-17), Phase 1.

One machine-only write and three staff reads.

The write (`POST /inbound-emails`) is the third write surface in this app
that no logged-in person stands behind, and it is gated differently from the
other two. The QR vacancy-request form and the public careers apply form are
open to the world because a human being has to be able to use them; this one
is open to exactly one caller, so it is gated by a shared secret
(`require_mail_intake_secret`) rather than by a rate limiter and a honeypot.
It is still rate limited, but as a blast cap rather than as the control.

What the write is allowed to do is deliberately tiny: insert an
`InboundEmail`, store its attachments, insert their rows. It cannot move an
`Application`, cannot create a `Candidate`, and holds no `User`, so there is
no identity for it to act under even if a later edit tried. That is Phase 1's
whole safety story -- see `app/services/mail_intake.py`.

The reads are ordinary staff reads. They are role-gated with `require_roles`
rather than a new `PermissionEnum` value, following the same reasoning as the
reopen/unpublish transitions: a tighter gate costs nothing, and a new
permission would need an ADD VALUE migration that cannot be undone. If the
mail log turns out to need per-user granting, that is the moment to add one.

The mail log is NOT campus-scoped. An email arrives before anybody knows
which campus it concerns -- that is what classification is for -- so there is
no `campus_id` on the row to scope by and nothing honest to filter on. Only
roles in `GLOBAL_SCOPE_ROLES` can read it, which keeps that from becoming a
leak rather than papering over it.
"""

import base64
import binascii
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import (
    get_db,
    require_mail_intake_secret,
    require_roles,
)
from app.core.rate_limit import RateLimiter
from app.models.enums import EmailCategoryEnum, UserRoleEnum
from app.models.inbound_email import EmailAttachment
from app.models.user import User
from app.schemas.inbound_email import (
    InboundEmailIngest,
    InboundEmailIngestResult,
    InboundEmailList,
    InboundEmailRead,
    InboundEmailSummary,
)
from app.services import mail_intake, storage
from app.services.audit import log_event
from app.services.storage import get_minio_client

router = APIRouter(prefix="/inbound-emails", tags=["mail intake"])

# A ceiling, not the access control -- the secret is. Sized for a real inbox
# being drained by n8n (a backlog catch-up runs hot for a minute), not for a
# human typing.
_intake_rate_limit = RateLimiter(max_requests=120, window_seconds=60, name="mail-intake")

# 10 MB, the same cap as every other upload in this app.
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

# Who may read the mail log. Every one of these is in GLOBAL_SCOPE_ROLES,
# which is what makes an unscoped read defensible -- see the module docstring.
_MAIL_LOG_READERS = (
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
)


@router.post(
    "",
    response_model=InboundEmailIngestResult,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_mail_intake_secret), Depends(_intake_rate_limit)],
)
def ingest_email(
    payload: InboundEmailIngest,
    request: Request,
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
) -> InboundEmailIngestResult:
    """Record one Gmail message pushed in by n8n.

    200 and not 201 even when a row is created, because the caller's useful
    distinction is `created`, not the status code: a replayed message is a
    success with `created=false`, and making a replay look like an error
    would have n8n retrying forever.

    Attachments are decoded and size-checked here, before `record_email` is
    called, so a bad attachment is a 400 about the request rather than a
    half-written email.
    """
    decoded: list[tuple[str, str | None, bytes]] = []
    for attachment in payload.attachments:
        try:
            data = base64.b64decode(attachment.content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attachment '{attachment.filename}' is not valid base64",
            ) from exc
        if not data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attachment '{attachment.filename}' is empty",
            )
        if len(data) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attachment '{attachment.filename}' exceeds the 10 MB limit",
            )
        decoded.append((attachment.filename, attachment.mime_type, data))

    email, created, stored = mail_intake.record_email(
        db, minio_client, payload=payload, decoded_attachments=decoded
    )

    # Audited with actor=None: n8n is not a person and must not be recorded
    # as one. A replay is audited too, and says so -- "nothing happened" is
    # worth being able to see.
    log_event(
        db,
        actor=None,
        action="INBOUND_EMAIL_RECORDED" if created else "INBOUND_EMAIL_REPLAYED",
        entity_type="InboundEmail",
        entity_id=email.id,
        after_state={
            "gmail_message_id": email.gmail_message_id,
            "from_email": email.from_email,
            "attachments_stored": stored,
            "created": created,
        },
        request=request,
        status_code=status.HTTP_200_OK,
    )
    # Read before the commit: `get_db` does NOT commit (it only closes), so
    # every writing router commits for itself, and a commit expires these
    # attributes -- touching them afterwards would mean a second SELECT.
    result = InboundEmailIngestResult(
        id=email.id,
        gmail_message_id=email.gmail_message_id,
        created=created,
        attachments_stored=stored,
    )
    db.commit()
    return result


@router.get("", response_model=InboundEmailList)
def list_inbound_emails(
    category: EmailCategoryEnum | None = Query(None),
    needs_review: bool | None = Query(None),
    processed: bool | None = Query(
        None, description="true = classification has run; false = still pending"
    ),
    from_email: str | None = Query(None, max_length=255),
    q: str | None = Query(None, max_length=200, description="Matches the subject"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_MAIL_LOG_READERS)),
) -> InboundEmailList:
    """The mail log, newest first. Everything is NULL/unclassified in Phase 1,
    so `processed=false` currently matches every row."""
    rows, total = mail_intake.list_emails(
        db,
        category=category,
        needs_review=needs_review,
        processed=processed,
        from_email=from_email,
        q=q,
        limit=limit,
        offset=offset,
    )
    return InboundEmailList(
        items=[InboundEmailSummary.model_validate(row) for row in rows], total=total
    )


@router.get("/attachments/{attachment_id}/file")
def download_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_MAIL_LOG_READERS)),
    minio_client: Minio = Depends(get_minio_client),
) -> StreamingResponse:
    """Serve one attachment back exactly as it arrived.

    `as attachment`, not `inline` like a joining document: these bytes came
    from outside and have not been checked against their declared type, so
    the browser should not be invited to render them.
    """
    attachment = db.get(EmailAttachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    data = storage.download_email_attachment_bytes(minio_client, attachment.storage_path)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{attachment.filename}"'},
    )


@router.get("/{email_id}", response_model=InboundEmailRead)
def get_inbound_email(
    email_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_MAIL_LOG_READERS)),
) -> InboundEmailRead:
    email = mail_intake.get_email(db, email_id)
    if email is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return InboundEmailRead.model_validate(email)
