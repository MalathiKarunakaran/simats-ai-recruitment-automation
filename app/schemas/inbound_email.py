"""Shapes for recruitment mail intake (2026-10-17), Phase 1.

Two audiences, two directions:

- `InboundEmailIngest` is what n8n sends. It mirrors a Gmail message, so
  almost everything is optional -- real mail arrives with no subject, no
  text part, or a `From` with no display name, and intake must record that
  rather than refuse it. The only things genuinely required are the message
  id (the idempotency key), the sender address and when it arrived.
- `InboundEmailRead` / `InboundEmailSummary` are what staff see. They carry
  the classification columns even though Phase 1 leaves them NULL, so the
  review screen does not change shape when Phase 2 starts filling them in.

Attachment *bytes* never travel in this JSON. n8n sends them base64-encoded
in `attachments[].content_base64`; see the ingest endpoint for the size cap
and `services/mail_intake.py` for what gets stored.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import EmailCategoryEnum


class InboundEmailAttachmentIngest(BaseModel):
    filename: str = Field(max_length=255)
    mime_type: str | None = Field(None, max_length=128)
    # Base64 as n8n's Gmail node hands it over. Decoded and size-checked by
    # the endpoint before anything is written.
    content_base64: str


class InboundEmailIngest(BaseModel):
    gmail_message_id: str = Field(max_length=128)
    thread_id: str | None = Field(None, max_length=128)
    from_email: EmailStr
    from_name: str | None = Field(None, max_length=255)
    subject: str | None = None
    body_text: str | None = None
    received_at: datetime
    attachments: list[InboundEmailAttachmentIngest] = Field(default_factory=list)


class EmailAttachmentRead(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str | None
    size_bytes: int | None
    is_resume: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class InboundEmailSummary(BaseModel):
    """One row in the mail log."""

    id: uuid.UUID
    gmail_message_id: str
    thread_id: str | None
    from_email: str
    from_name: str | None
    subject: str | None
    received_at: datetime
    category: EmailCategoryEnum | None
    confidence: float | None
    needs_review: bool
    processed_at: datetime | None
    error: str | None
    attachment_count: int

    model_config = {"from_attributes": True}


class InboundEmailRead(InboundEmailSummary):
    """One message, opened. Adds the body and the attachment rows; the links
    out are ids only -- Phase 1 never sets them, and resolving them to names
    is the review screen's job once Phase 2 does."""

    body_text: str | None
    linked_candidate_id: uuid.UUID | None
    linked_application_id: uuid.UUID | None
    linked_job_posting_id: uuid.UUID | None
    attachments: list[EmailAttachmentRead]
    created_at: datetime

    model_config = {"from_attributes": True}


class InboundEmailList(BaseModel):
    items: list[InboundEmailSummary]
    total: int


class InboundEmailIngestResult(BaseModel):
    """What n8n gets back. `created` false means this message id was already
    recorded and nothing was written -- a replay, not an error, so the reply
    is still 200 and still carries the row's id."""

    id: uuid.UUID
    gmail_message_id: str
    created: bool
    attachments_stored: int
