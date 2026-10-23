"""Recruitment mail intake -- inbound_emails and email_attachments

Revision ID: a7b8c9d0e1f2
Revises: d7e8f9a0b1c2
Create Date: 2026-10-17

Phase 1 of mail intake: two tables that record what arrived in the
recruitment inbox, and nothing that acts on it.

The classification columns (`category`, `confidence`, `needs_review`) and the
three nullable links out to candidates/applications/job_postings are created
here even though Phase 1 never writes anything but `needs_review=false`.
That is deliberate: it makes Phase 2 a service and a test, not another
migration against a table that by then has production rows in it.

`email_category_enum` is created here and dropped on downgrade, which is
clean because nothing before this revision refers to it. Note the usual
caveat for later: adding a category afterwards needs ALTER TYPE ... ADD
VALUE in its own revision, and cannot be undone.

The three links are ON DELETE SET NULL, not RESTRICT like the links between
recruitment entities. An email is evidence; deleting a Candidate should not
be blocked by, nor rewrite, the message that produced them. Attachments are
the one CASCADE here -- they have no meaning apart from their email.
"""

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None

_EMAIL_CATEGORY_VALUES = (
    "NEW_APPLICATION",
    "STATUS_ENQUIRY",
    "INTERVIEW_RESPONSE",
    "OFFER_RESPONSE",
    "DOCUMENTS_SUBMITTED",
    "WITHDRAWAL",
    "OTHER",
)


def upgrade() -> None:
    op.create_table(
        "inbound_emails",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("gmail_message_id", sa.String(length=128), nullable=False),
        sa.Column("thread_id", sa.String(length=128), nullable=True),
        sa.Column("from_email", sa.String(length=255), nullable=False),
        sa.Column("from_name", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "category",
            sa.Enum(*_EMAIL_CATEGORY_VALUES, name="email_category_enum"),
            nullable=True,
        ),
        sa.Column("confidence", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column(
            "needs_review", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("linked_candidate_id", sa.UUID(), nullable=True),
        sa.Column("linked_application_id", sa.UUID(), nullable=True),
        sa.Column("linked_job_posting_id", sa.UUID(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["linked_application_id"], ["applications.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["linked_candidate_id"], ["candidates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["linked_job_posting_id"], ["job_postings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_inbound_emails_category"), "inbound_emails", ["category"])
    op.create_index(op.f("ix_inbound_emails_from_email"), "inbound_emails", ["from_email"])
    # The idempotency guarantee, and a UNIQUE INDEX rather than a separate
    # UNIQUE constraint because that is exactly what the model's
    # `unique=True, index=True` asks for -- declaring both here instead made
    # scripts/check_schema_drift.py fail, correctly. A replayed n8n run hits
    # this, not a duplicate row: services/mail_intake.py catches the
    # IntegrityError it raises and returns the row already there.
    op.create_index(
        op.f("ix_inbound_emails_gmail_message_id"),
        "inbound_emails",
        ["gmail_message_id"],
        unique=True,
    )
    op.create_index(op.f("ix_inbound_emails_linked_application_id"), "inbound_emails", ["linked_application_id"])
    op.create_index(op.f("ix_inbound_emails_linked_candidate_id"), "inbound_emails", ["linked_candidate_id"])
    op.create_index(op.f("ix_inbound_emails_linked_job_posting_id"), "inbound_emails", ["linked_job_posting_id"])
    op.create_index(op.f("ix_inbound_emails_needs_review"), "inbound_emails", ["needs_review"])
    op.create_index(op.f("ix_inbound_emails_processed_at"), "inbound_emails", ["processed_at"])
    op.create_index(op.f("ix_inbound_emails_received_at"), "inbound_emails", ["received_at"])
    op.create_index(op.f("ix_inbound_emails_thread_id"), "inbound_emails", ["thread_id"])

    op.create_table(
        "email_attachments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("inbound_email_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("size_bytes", sa.Numeric(precision=12, scale=0), nullable=True),
        sa.Column("is_resume", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["inbound_email_id"], ["inbound_emails.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_email_attachments_inbound_email_id"), "email_attachments", ["inbound_email_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_email_attachments_inbound_email_id"), table_name="email_attachments")
    op.drop_table("email_attachments")
    for index in (
        "ix_inbound_emails_thread_id",
        "ix_inbound_emails_received_at",
        "ix_inbound_emails_processed_at",
        "ix_inbound_emails_needs_review",
        "ix_inbound_emails_linked_job_posting_id",
        "ix_inbound_emails_linked_candidate_id",
        "ix_inbound_emails_linked_application_id",
        "ix_inbound_emails_gmail_message_id",
        "ix_inbound_emails_from_email",
        "ix_inbound_emails_category",
    ):
        op.drop_index(op.f(index), table_name="inbound_emails")
    op.drop_table("inbound_emails")
    # DROP TABLE leaves the enum type behind; this revision created it and
    # nothing earlier refers to it, so dropping it is clean.
    op.execute("DROP TYPE IF EXISTS email_category_enum")
