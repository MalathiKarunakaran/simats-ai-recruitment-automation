"""Recruitment mail intake (2026-10-17), Phase 1.

One row per Gmail message pushed in by n8n, plus one row per attachment.
These tables are a *log of what arrived*, deliberately separate from the
recruitment records they will later point at: an email is evidence, and
deleting or editing a Candidate must never rewrite the mail that produced
it. Every link out (`linked_candidate_id`, `linked_application_id`,
`linked_job_posting_id`) is therefore nullable and `ondelete="SET NULL"` --
the opposite of the RESTRICT used between the recruitment entities
themselves, because losing the link is survivable and losing the email is
not.

Nothing here classifies, matches or mutates an Application. Phase 1 only
records. `category`/`confidence`/`needs_review` and the three link columns
exist now so that Phase 2 is a service, not a migration; until then they
stay NULL/false.

`processed_at IS NULL` is the pending-work marker -- no separate queue
column, and no scheduler. A row with `processed_at` set has been through
classification; one with `error` set failed and is visible in the review
queue.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import EmailCategoryEnum


class InboundEmail(Base):
    __tablename__ = "inbound_emails"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # The idempotency key. Gmail's immutable per-message id, UNIQUE so a
    # replayed n8n run cannot produce a second row even if two workers race
    # -- see services/mail_intake.py, which catches the IntegrityError that
    # race raises and returns the winner's row.
    gmail_message_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    thread_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    from_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # --- Classification (written by Phase 2, NULL until then) --------------
    category: Mapped[EmailCategoryEnum | None] = mapped_column(
        Enum(EmailCategoryEnum, name="email_category_enum"), nullable=True, index=True
    )
    # 0.000-1.000 as the classifier reports it, not a percentage -- the
    # threshold people will quote is "0.75", so store the number they mean.
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3, asdecimal=False), nullable=True)
    needs_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )

    linked_candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    linked_application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="SET NULL"), nullable=True, index=True
    )
    linked_job_posting_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_postings.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # NULL = not yet processed. This is the work queue.
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    attachments: Mapped[list["EmailAttachment"]] = relationship(
        back_populates="inbound_email", cascade="all, delete-orphan"
    )
    linked_candidate: Mapped["Candidate | None"] = relationship()  # noqa: F821
    linked_application: Mapped["Application | None"] = relationship()  # noqa: F821
    linked_job_posting: Mapped["JobPosting | None"] = relationship()  # noqa: F821

    @property
    def attachment_count(self) -> int:
        return len(self.attachments)

    @property
    def is_processed(self) -> bool:
        return self.processed_at is not None

    def __repr__(self) -> str:
        return f"<InboundEmail {self.gmail_message_id} from={self.from_email}>"


class EmailAttachment(Base):
    __tablename__ = "email_attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # CASCADE, unlike the RESTRICT used between recruitment entities: an
    # attachment has no meaning apart from the email it arrived on, so it
    # should not be able to outlive it or block its removal.
    inbound_email_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("inbound_emails.id", ondelete="CASCADE"), nullable=False, index=True
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # MinIO object key in MINIO_BUCKET_EMAIL_ATTACHMENTS. NOT NULL: the row
    # is only written after the bytes have landed (see mail_intake.py), so a
    # key-less attachment row would be a lie about what is stored.
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Numeric(12, 0, asdecimal=False), nullable=True)
    # Set at intake from the filename/MIME type alone -- a cheap guess, not a
    # verdict. Phase 3 reads it to decide what to try to screen.
    is_resume: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    inbound_email: Mapped["InboundEmail"] = relationship(back_populates="attachments")

    def __repr__(self) -> str:
        return f"<EmailAttachment {self.filename} resume={self.is_resume}>"
