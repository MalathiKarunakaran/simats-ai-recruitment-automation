"""Job posting content, lifecycle status, reference numbers, and grants.

A posting had no text of its own and no state beyond is_active; the
approved vacancy (the recruitment requisition) had no number people could
quote. This revision:

1. adds `requisition_number` to approved_vacancies and `posting_number`,
   `status`, the ad snapshot (ad_title, ad_body, apply_deadline,
   contact_email) and last-edited fields to job_postings;
2. backfills every existing row: numbers in publication order
   (RQ-/JP-<year>-<seq>, the year taken from the row's own timestamp so it
   matches what the service would have produced), status from is_active,
   and the ad snapshot from the request's title and JD draft (or the
   templated body the ad builder used to fall back to);
3. grants the labels added by f0a1b2c3d4e5: every JOB_DISTRIBUTION holder
   gets EDIT_JOB_POSTING and REVIEW_POSTING_CHANNELS (they could already do
   both halves of that act), every HR_ADMIN gets
   MANAGE_RECRUITMENT_CHANNELS. Super Admins need no rows.

`is_active` stays and stays in step: PUBLISHED/PAUSED are active, CLOSED
is not. Every reader of is_active keeps working unchanged.

Revision ID: c4d5e6f7a8b9
Revises: f0a1b2c3d4e5
Create Date: 2026-09-06
"""

import sqlalchemy as sa
from alembic import op

revision = "c4d5e6f7a8b9"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- approved_vacancies: requisition number ---------------------------
    op.add_column("approved_vacancies", sa.Column("requisition_number", sa.String(length=20), nullable=True))
    op.create_index(
        op.f("ix_approved_vacancies_requisition_number"), "approved_vacancies", ["requisition_number"], unique=True
    )

    # --- job_postings: number, status, ad snapshot, edit trail -------------
    posting_status = sa.Enum("PUBLISHED", "PAUSED", "CLOSED", name="job_posting_status_enum")
    posting_status.create(op.get_bind(), checkfirst=True)
    op.add_column("job_postings", sa.Column("posting_number", sa.String(length=20), nullable=True))
    op.add_column(
        "job_postings",
        sa.Column("status", posting_status, nullable=False, server_default="PUBLISHED"),
    )
    op.add_column("job_postings", sa.Column("ad_title", sa.String(length=200), nullable=True))
    op.add_column("job_postings", sa.Column("ad_body", sa.Text(), nullable=True))
    op.add_column("job_postings", sa.Column("apply_deadline", sa.Date(), nullable=True))
    op.add_column("job_postings", sa.Column("contact_email", sa.String(length=255), nullable=True))
    op.add_column("job_postings", sa.Column("last_edited_by_id", sa.UUID(), nullable=True))
    op.add_column("job_postings", sa.Column("last_edited_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        op.f("fk_job_postings_last_edited_by_id_users"),
        "job_postings",
        "users",
        ["last_edited_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_job_postings_posting_number"), "job_postings", ["posting_number"], unique=True)
    op.create_index(op.f("ix_job_postings_status"), "job_postings", ["status"], unique=False)

    # --- backfill numbers: per-year sequence in creation order --------------
    op.execute(
        """
        WITH numbered AS (
            SELECT id,
                   'RQ-' || to_char(approved_at, 'YYYY') || '-' ||
                   lpad(row_number() OVER (PARTITION BY to_char(approved_at, 'YYYY') ORDER BY approved_at, id)::text,
                        6, '0') AS num
            FROM approved_vacancies
        )
        UPDATE approved_vacancies av SET requisition_number = numbered.num
        FROM numbered WHERE av.id = numbered.id AND av.requisition_number IS NULL
        """
    )
    op.execute(
        """
        WITH numbered AS (
            SELECT id,
                   'JP-' || to_char(published_at, 'YYYY') || '-' ||
                   lpad(row_number() OVER (PARTITION BY to_char(published_at, 'YYYY') ORDER BY published_at, id)::text,
                        6, '0') AS num
            FROM job_postings
        )
        UPDATE job_postings jp SET posting_number = numbered.num
        FROM numbered WHERE jp.id = numbered.id AND jp.posting_number IS NULL
        """
    )

    # --- backfill status from is_active, ad snapshot from the request -------
    op.execute("UPDATE job_postings SET status = 'CLOSED' WHERE is_active = false")
    op.execute(
        """
        UPDATE job_postings jp
        SET ad_title = left(vr.position_title, 200),
            ad_body  = COALESCE(
                NULLIF(vr.jd_draft, ''),
                vr.position_title || ' (' || vr.employment_type::text || ')' || chr(10) ||
                'Qualification: ' || vr.qualification || chr(10) ||
                'Experience: ' || vr.experience_required
            )
        FROM approved_vacancies av
        JOIN vacancy_requests vr ON vr.id = av.vacancy_request_id
        WHERE av.id = jp.approved_vacancy_id AND jp.ad_title IS NULL
        """
    )

    # --- grants for the labels added by f0a1b2c3d4e5 -------------------------
    for new_label in ("EDIT_JOB_POSTING", "REVIEW_POSTING_CHANNELS"):
        op.execute(
            f"""
            INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
            SELECT gen_random_uuid(), g.user_id, '{new_label}', g.granted_by_id, now()
            FROM user_permission_grants g
            WHERE g.permission = 'JOB_DISTRIBUTION'
              AND NOT EXISTS (
                  SELECT 1 FROM user_permission_grants x
                  WHERE x.user_id = g.user_id AND x.permission = '{new_label}'
              )
            """
        )
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), u.id, 'MANAGE_RECRUITMENT_CHANNELS', NULL, now()
        FROM users u
        WHERE u.role = 'HR_ADMIN'
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants g
              WHERE g.user_id = u.id AND g.permission = 'MANAGE_RECRUITMENT_CHANNELS'
          )
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM user_permission_grants WHERE permission IN "
        "('EDIT_JOB_POSTING', 'REVIEW_POSTING_CHANNELS', 'MANAGE_RECRUITMENT_CHANNELS')"
    )
    op.drop_index(op.f("ix_job_postings_status"), table_name="job_postings")
    op.drop_index(op.f("ix_job_postings_posting_number"), table_name="job_postings")
    op.drop_constraint(op.f("fk_job_postings_last_edited_by_id_users"), "job_postings", type_="foreignkey")
    for column in (
        "last_edited_at", "last_edited_by_id", "contact_email", "apply_deadline", "ad_body", "ad_title",
        "status", "posting_number",
    ):
        op.drop_column("job_postings", column)
    op.execute("DROP TYPE IF EXISTS job_posting_status_enum")
    op.drop_index(op.f("ix_approved_vacancies_requisition_number"), table_name="approved_vacancies")
    op.drop_column("approved_vacancies", "requisition_number")
