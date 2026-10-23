"""Recruitment mail intake (2026-10-17), Phase 1: record what arrived.

This module is the only writer of `InboundEmail` and `EmailAttachment`. It
records and it does nothing else -- no classification, no candidate matching,
no `Application` touched, no notification sent. That restraint is the design,
not an unfinished edge: `pipeline.py` remains the single choke point for
application status, and when Phase 2 starts acting on these rows it will do
so by calling into `pipeline.transition_application_status`, never by
reaching into an Application from here.

**Idempotency.** `gmail_message_id` is UNIQUE, and `record_email` leans on
that constraint rather than on a prior SELECT. It does check first -- that is
the common case and avoids a pointless failed INSERT -- but the check is not
the guarantee. Two n8n workers replaying the same message can both pass the
check, and the loser gets an IntegrityError that is caught here and turned
into "already recorded". A SELECT-then-INSERT without the constraint would
quietly produce two rows for one email.

**Attachment bytes land before their row.** Each attachment is uploaded to
MinIO first; only then is the row written with the key that upload returned.
`EmailAttachment.storage_path` is NOT NULL precisely so a row can never
claim bytes that are not there. The cost is the opposite leak -- an object
with no row if the transaction later rolls back -- which is the cheaper of
the two: an orphaned object wastes space, an orphaned row lies.
"""

import re
import uuid

from minio import Minio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.enums import EmailCategoryEnum
from app.models.inbound_email import EmailAttachment, InboundEmail
from app.schemas.inbound_email import InboundEmailIngest
from app.services.storage import upload_email_attachment

# What is *probably* a CV, by filename and type alone. A guess made at
# intake so Phase 3 knows what to try to read; never a verdict, and nothing
# in Phase 1 acts on it. Deliberately narrow: a false positive here would
# send a scanned certificate to the resume parser.
_RESUME_NAME_HINTS = ("resume", "cv", "curriculum", "biodata", "profile")
_RESUME_MIME_TYPES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
)

# Anything that could escape the key prefix or confuse a path. The key is
# f"{inbound_email_id}/{filename}", so a filename containing "/" or ".."
# would otherwise write outside its own email's folder.
_UNSAFE_IN_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")


def looks_like_resume(filename: str, mime_type: str | None) -> bool:
    name = filename.lower()
    if any(hint in name for hint in _RESUME_NAME_HINTS):
        return True
    # A lone PDF on a recruitment email usually is one; a PDF named
    # "offer_letter.pdf" is caught by the hint check above being inclusive
    # rather than exclusive, which is the trade Phase 3 can tighten.
    return (mime_type or "").lower() in _RESUME_MIME_TYPES and name.endswith(
        (".pdf", ".doc", ".docx")
    )


def safe_filename(filename: str) -> str:
    """A storage-key-safe version of what the sender called the file.

    The original name is kept in `EmailAttachment.filename` -- this only
    sanitises the half that becomes an object key.
    """
    cleaned = _UNSAFE_IN_FILENAME.sub("_", filename.strip()).strip("._-")
    return (cleaned or "attachment")[:200]


def unique_filename(taken: set[str], filename: str) -> str:
    """Two attachments on one message can share a name; two objects under one
    key cannot. Appends `_2`, `_3`, ... to the stem until the key is free."""
    if filename not in taken:
        taken.add(filename)
        return filename
    stem, dot, ext = filename.rpartition(".")
    if not dot:
        stem, ext = filename, ""
    suffix = 2
    while True:
        candidate = f"{stem}_{suffix}{dot}{ext}" if dot else f"{stem}_{suffix}"
        if candidate not in taken:
            taken.add(candidate)
            return candidate
        suffix += 1


def get_existing(db: Session, gmail_message_id: str) -> InboundEmail | None:
    return db.scalar(
        select(InboundEmail).where(InboundEmail.gmail_message_id == gmail_message_id)
    )


def record_email(
    db: Session,
    minio_client: Minio,
    *,
    payload: InboundEmailIngest,
    decoded_attachments: list[tuple[str, str | None, bytes]],
) -> tuple[InboundEmail, bool, int]:
    """Record one message and its attachments. Returns (row, created, stored).

    `decoded_attachments` is (original filename, mime type, bytes) -- already
    base64-decoded and size-checked by the caller, because rejecting an
    oversized attachment is an HTTP concern and this function is not allowed
    to raise HTTP errors for anything but a storage failure.

    `created` is False for a replay: the row already existed, nothing was
    written, and no attachment was re-uploaded.
    """
    existing = get_existing(db, payload.gmail_message_id)
    if existing is not None:
        return existing, False, 0

    email = InboundEmail(
        gmail_message_id=payload.gmail_message_id,
        thread_id=payload.thread_id,
        from_email=str(payload.from_email).lower(),
        from_name=payload.from_name,
        subject=payload.subject,
        body_text=payload.body_text,
        received_at=payload.received_at,
        # Phase 1 classifies nothing. Spelled out rather than left to the
        # column defaults so the intent is readable here too.
        category=None,
        confidence=None,
        needs_review=False,
        processed_at=None,
    )
    # A SAVEPOINT, not the caller's transaction. If the unique constraint
    # fires we must undo only this INSERT: a plain db.rollback() here would
    # throw away everything the request had already done (and, in the test
    # suite, every fixture row created inside the enclosing savepoint).
    savepoint = db.begin_nested()
    db.add(email)
    try:
        # Needed before the attachment keys can be built, and the point at
        # which a racing duplicate is refused by the unique constraint.
        db.flush()
    except IntegrityError:
        savepoint.rollback()
        # Rolling back a savepoint restores a flushed object to pending, so
        # without this the next flush would retry the same failing INSERT.
        db.expunge(email)
        winner = get_existing(db, payload.gmail_message_id)
        if winner is None:
            # The constraint fired for something other than the message id.
            raise
        return winner, False, 0
    savepoint.commit()

    taken: set[str] = set()
    for original_name, mime_type, data in decoded_attachments:
        key_name = unique_filename(taken, safe_filename(original_name))
        storage_path = upload_email_attachment(
            minio_client,
            inbound_email_id=email.id,
            filename=key_name,
            data=data,
            content_type=mime_type,
        )
        db.add(
            EmailAttachment(
                inbound_email_id=email.id,
                filename=original_name[:255],
                mime_type=mime_type,
                storage_path=storage_path,
                size_bytes=len(data),
                is_resume=looks_like_resume(original_name, mime_type),
            )
        )
    db.flush()
    return email, True, len(decoded_attachments)


def get_email(db: Session, email_id: uuid.UUID) -> InboundEmail | None:
    return db.scalar(
        select(InboundEmail)
        .where(InboundEmail.id == email_id)
        .options(selectinload(InboundEmail.attachments))
    )


def list_emails(
    db: Session,
    *,
    category: EmailCategoryEnum | None = None,
    needs_review: bool | None = None,
    processed: bool | None = None,
    from_email: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[InboundEmail], int]:
    """The mail log, newest first.

    `processed` filters on `processed_at IS NULL` -- the pending-work marker
    the model's docstring describes -- rather than on a separate status
    column, so there is only ever one answer to "has this been through
    classification".
    """
    conditions = []
    if category is not None:
        conditions.append(InboundEmail.category == category)
    if needs_review is not None:
        conditions.append(InboundEmail.needs_review.is_(needs_review))
    if processed is not None:
        conditions.append(
            InboundEmail.processed_at.isnot(None) if processed else InboundEmail.processed_at.is_(None)
        )
    if from_email:
        conditions.append(InboundEmail.from_email == from_email.strip().lower())
    if q:
        conditions.append(InboundEmail.subject.ilike(f"%{q.strip()}%"))

    total = db.scalar(select(func.count()).select_from(InboundEmail).where(*conditions)) or 0
    rows = list(
        db.scalars(
            select(InboundEmail)
            .where(*conditions)
            .options(selectinload(InboundEmail.attachments))
            .order_by(InboundEmail.received_at.desc(), InboundEmail.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return rows, total
