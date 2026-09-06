"""Recruitment channels, posting channels, posting attempts, channel rules.

Distribution used to be four string constants and one n8n call whose only
trace was a pair of audit rows. These four tables hold which channels
exist, which a posting is on and in what state, every attempt made, and the
deterministic rules that recommend channels for a new posting.

Seeds the channels the legacy distribute endpoint already knew (LINKEDIN,
INDEED, NAUKRI, FACULTYPLUS -- codes unchanged so old audit rows still read
correctly), plus CAREERS_PAGE, EMAIL, INTERNAL and REFERRAL, and four
starter rules: the careers page is auto-selected for everything, and each
staff category gets a recommended set. All editable afterwards.

Revision ID: e7f8a9b0c1d2
Revises: d2e3f4a5b6c7
Create Date: 2026-09-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e7f8a9b0c1d2"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None

# Existing enum types, referenced without re-creating them.
_staff_category = postgresql.ENUM(
    "TEACHING", "NON_TEACHING", "HOUSEKEEPING", name="staff_role_category_enum", create_type=False
)
_employment_type = postgresql.ENUM(
    "FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT", "TRA", "JRF",
    name="employment_type_enum", create_type=False,
)

_NEW_ENUM_TYPES = (
    "recruitment_channel_kind_enum",
    "recruitment_channel_mode_enum",
    "job_posting_channel_status_enum",
    "channel_recommendation_source_enum",
    "posting_attempt_trigger_enum",
    "posting_attempt_outcome_enum",
)

# (code, name, kind, mode, integration_path, categories, display_order, notes)
_SEED_CHANNELS = (
    ("CAREERS_PAGE", "SIMATS careers page", "CAREERS_PAGE", "INTERNAL", None, "{}", 10,
     "Every published posting is listed here once the public careers pages exist."),
    ("LINKEDIN", "LinkedIn", "JOB_PORTAL", "API", "job-distribution", "{}", 20,
     "Posted through the n8n job-distribution workflow."),
    ("INDEED", "Indeed", "JOB_PORTAL", "API", "job-distribution", "{}", 30,
     "Posted through the n8n job-distribution workflow."),
    ("NAUKRI", "Naukri", "JOB_PORTAL", "API", "job-distribution", "{NON_TEACHING,HOUSEKEEPING}", 40,
     "Posted through the n8n job-distribution workflow."),
    # API for now so the existing distribute button (which still offers
    # FACULTYPLUS) keeps its contract; an admin flips it to MANUAL_ASSISTED
    # once the channels panel replaces that button.
    ("FACULTYPLUS", "FacultyPlus", "ACADEMIC_PORTAL", "API", "job-distribution", "{TEACHING}", 50,
     "Posted through the n8n job-distribution workflow; switch to manual-assisted if that workflow has no FacultyPlus step."),
    ("EMAIL", "Email circulation", "EMAIL", "API", "job-distribution", "{}", 60,
     "Circulated by the n8n workflow to the configured lists."),
    ("INTERNAL", "Internal notice / intranet", "INTERNAL", "MANUAL_ASSISTED", None, "{}", 70, None),
    ("REFERRAL", "Staff referral", "REFERRAL", "MANUAL_ASSISTED", None, "{}", 80, None),
)

# (name, priority, match_category, channel codes, auto_select, notes)
_SEED_RULES = (
    ("Careers page for every posting", 100, None, ("CAREERS_PAGE",), True,
     "Auto-selected: the careers page needs no review."),
    ("Teaching posts: academic and professional portals", 100, "TEACHING",
     ("FACULTYPLUS", "LINKEDIN", "EMAIL"), False, None),
    ("Non-teaching posts: job portals", 100, "NON_TEACHING", ("NAUKRI", "INDEED", "LINKEDIN"), False, None),
    ("Housekeeping posts: local channels", 100, "HOUSEKEEPING", ("INTERNAL", "REFERRAL", "NAUKRI"), False, None),
)


def upgrade() -> None:
    op.create_table(
        "recruitment_channels",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "JOB_PORTAL", "ACADEMIC_PORTAL", "SOCIAL", "CAREERS_PAGE", "EMAIL", "INTERNAL", "REFERRAL", "AGENCY",
                name="recruitment_channel_kind_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "mode",
            sa.Enum("API", "FEED", "MANUAL_ASSISTED", "INTERNAL", name="recruitment_channel_mode_enum"),
            nullable=False,
        ),
        sa.Column("integration_path", sa.String(length=200), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("applicable_categories", postgresql.ARRAY(_staff_category), server_default="{}", nullable=False),
        sa.Column("applicable_campus_ids", postgresql.ARRAY(sa.UUID()), server_default="{}", nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recruitment_channels")),
    )
    op.create_index(op.f("ix_recruitment_channels_code"), "recruitment_channels", ["code"], unique=True)

    op.create_table(
        "channel_rules",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("match_category", _staff_category, nullable=True),
        sa.Column("match_campus_id", sa.UUID(), nullable=True),
        sa.Column("match_department_id", sa.UUID(), nullable=True),
        sa.Column("match_designation_id", sa.UUID(), nullable=True),
        sa.Column("match_employment_type", _employment_type, nullable=True),
        sa.Column("channel_ids", postgresql.ARRAY(sa.UUID()), server_default="{}", nullable=False),
        sa.Column("auto_select", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["match_campus_id"], ["campuses.id"], name=op.f("fk_channel_rules_match_campus_id_campuses"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["match_department_id"], ["departments.id"],
            name=op.f("fk_channel_rules_match_department_id_departments"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["match_designation_id"], ["designations.id"],
            name=op.f("fk_channel_rules_match_designation_id_designations"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_channel_rules")),
    )

    op.create_table(
        "job_posting_channels",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("job_posting_id", sa.UUID(), nullable=False),
        sa.Column("channel_id", sa.UUID(), nullable=False),
        sa.Column("campus_id", sa.UUID(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "RECOMMENDED", "SELECTED", "QUEUED", "POSTED", "FAILED", "EXPIRED", "REMOVED",
                name="job_posting_channel_status_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "recommended_by",
            sa.Enum("RULE", "USER", "AI", name="channel_recommendation_source_enum"),
            nullable=False,
        ),
        sa.Column("recommendation_reason", sa.Text(), nullable=True),
        sa.Column("reviewed_by_id", sa.UUID(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_ref", sa.String(length=200), nullable=True),
        sa.Column("external_url", sa.String(length=500), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_attempt_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["campus_id"], ["campuses.id"], name=op.f("fk_job_posting_channels_campus_id_campuses"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["recruitment_channels.id"],
            name=op.f("fk_job_posting_channels_channel_id_recruitment_channels"), ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_posting_id"], ["job_postings.id"],
            name=op.f("fk_job_posting_channels_job_posting_id_job_postings"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"], ["users.id"], name=op.f("fk_job_posting_channels_reviewed_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_posting_channels")),
        sa.UniqueConstraint("job_posting_id", "channel_id", name="uq_job_posting_channel_posting_channel"),
    )
    op.create_index(op.f("ix_job_posting_channels_campus_id"), "job_posting_channels", ["campus_id"], unique=False)
    op.create_index(op.f("ix_job_posting_channels_channel_id"), "job_posting_channels", ["channel_id"], unique=False)
    op.create_index(
        op.f("ix_job_posting_channels_job_posting_id"), "job_posting_channels", ["job_posting_id"], unique=False
    )
    op.create_index(op.f("ix_job_posting_channels_status"), "job_posting_channels", ["status"], unique=False)

    op.create_table(
        "posting_attempts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("job_posting_channel_id", sa.UUID(), nullable=False),
        sa.Column("campus_id", sa.UUID(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column(
            "trigger",
            sa.Enum("MANUAL", "RETRY", "LEGACY_DISTRIBUTE", name="posting_attempt_trigger_enum"),
            nullable=False,
        ),
        sa.Column(
            "outcome",
            sa.Enum("SUCCEEDED", "FAILED", "TIMEOUT", "NOT_CONFIGURED", name="posting_attempt_outcome_enum"),
            nullable=False,
        ),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("attempted_by_id", sa.UUID(), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["attempted_by_id"], ["users.id"], name=op.f("fk_posting_attempts_attempted_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["campus_id"], ["campuses.id"], name=op.f("fk_posting_attempts_campus_id_campuses"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["job_posting_channel_id"], ["job_posting_channels.id"],
            name=op.f("fk_posting_attempts_job_posting_channel_id_job_posting_channels"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_posting_attempts")),
        sa.UniqueConstraint("job_posting_channel_id", "attempt_number", name="uq_posting_attempt_channel_number"),
    )
    op.create_index(op.f("ix_posting_attempts_campus_id"), "posting_attempts", ["campus_id"], unique=False)
    op.create_index(
        op.f("ix_posting_attempts_job_posting_channel_id"), "posting_attempts", ["job_posting_channel_id"],
        unique=False,
    )
    op.create_index(op.f("ix_posting_attempts_outcome"), "posting_attempts", ["outcome"], unique=False)

    # --- seed channels and starter rules (idempotent by code / name) ------
    for code, name, kind, mode, path, categories, order, notes in _SEED_CHANNELS:
        op.execute(
            sa.text(
                """
                INSERT INTO recruitment_channels
                    (code, name, kind, mode, integration_path, applicable_categories, is_active, display_order, notes)
                SELECT :code, :name, CAST(:kind AS recruitment_channel_kind_enum),
                       CAST(:mode AS recruitment_channel_mode_enum), :path,
                       CAST(:categories AS staff_role_category_enum[]), true, :order, :notes
                WHERE NOT EXISTS (SELECT 1 FROM recruitment_channels WHERE code = :code)
                """
            ).bindparams(
                code=code, name=name, kind=kind, mode=mode, path=path, categories=categories, order=order, notes=notes
            )
        )
    for name, priority, category, codes, auto_select, notes in _SEED_RULES:
        op.execute(
            sa.text(
                """
                INSERT INTO channel_rules (name, is_active, priority, match_category, channel_ids, auto_select, notes)
                SELECT :name, true, :priority, CAST(:category AS staff_role_category_enum),
                       ARRAY(SELECT id FROM recruitment_channels WHERE code = ANY(CAST(:codes AS text[]))
                             ORDER BY display_order),
                       :auto_select, :notes
                WHERE NOT EXISTS (SELECT 1 FROM channel_rules WHERE name = :name)
                """
            ).bindparams(
                name=name, priority=priority, category=category, codes="{" + ",".join(codes) + "}",
                auto_select=auto_select, notes=notes,
            )
        )


def downgrade() -> None:
    op.drop_index(op.f("ix_posting_attempts_outcome"), table_name="posting_attempts")
    op.drop_index(op.f("ix_posting_attempts_job_posting_channel_id"), table_name="posting_attempts")
    op.drop_index(op.f("ix_posting_attempts_campus_id"), table_name="posting_attempts")
    op.drop_table("posting_attempts")
    op.drop_index(op.f("ix_job_posting_channels_status"), table_name="job_posting_channels")
    op.drop_index(op.f("ix_job_posting_channels_job_posting_id"), table_name="job_posting_channels")
    op.drop_index(op.f("ix_job_posting_channels_channel_id"), table_name="job_posting_channels")
    op.drop_index(op.f("ix_job_posting_channels_campus_id"), table_name="job_posting_channels")
    op.drop_table("job_posting_channels")
    op.drop_table("channel_rules")
    op.drop_index(op.f("ix_recruitment_channels_code"), table_name="recruitment_channels")
    op.drop_table("recruitment_channels")
    # DROP TABLE does not drop the enum types created for these columns;
    # all six were created by this revision, so dropping them is clean.
    for enum_name in _NEW_ENUM_TYPES:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
