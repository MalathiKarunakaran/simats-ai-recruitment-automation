"""Job posting structured content, review trail, grants, manual channels.

1. job_postings gains structured content (summary, responsibilities,
   required qualification/experience/skills, preferred skills, employment
   type, location, salary range, ai_generated_at) and a review trail
   (created_by, submitted_for_review_by/at, approved_by/at, published_by).
   `published_at` becomes nullable: a posting now starts as a DRAFT and has
   no publication date until it goes live.
2. Backfills every existing posting. They were all live the moment they were
   created, so they keep their status (PUBLISHED/PAUSED/CLOSED) untouched.
   Content is copied from each posting's vacancy request, exactly as
   job_postings.snapshot_content does for a new one; created_by is the actor
   of the posting's JOB_POSTING_CREATED audit row (else the approver of its
   vacancy), and published_by is the same person.
3. Grants the labels added by b8c7d6e5f4a3: every HR_ADMIN gets
   APPROVE_JOB_POSTING and PUBLISH_JOB_POSTING; every PUBLISH_VACANCY holder
   gets PUBLISH_JOB_POSTING, so whoever could put a vacancy's ad live before
   the review stage still can once it is approved. Super Admins need no rows.
4. Switches FACULTYPLUS, LINKEDIN, INDEED, NAUKRI and EMAIL from API to
   MANUAL_ASSISTED (user decision 2026-09-15): no n8n host or approved portal
   API exists, so these are posted by hand and their reference recorded.
   Only rows still in API mode are touched.

Revision ID: e8f9a0b1c2d3
Revises: b8c7d6e5f4a3
Create Date: 2026-09-15
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e8f9a0b1c2d3"
down_revision = "b8c7d6e5f4a3"
branch_labels = None
depends_on = None

_MANUAL_CODES = "('FACULTYPLUS', 'LINKEDIN', 'INDEED', 'NAUKRI', 'EMAIL')"
_USER_FKS = ("created_by_id", "submitted_for_review_by_id", "approved_by_id", "published_by_id")


def upgrade() -> None:
    # --- columns ------------------------------------------------------------
    op.add_column("job_postings", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("job_postings", sa.Column("responsibilities", sa.Text(), nullable=True))
    op.add_column("job_postings", sa.Column("required_qualification", sa.Text(), nullable=True))
    op.add_column("job_postings", sa.Column("required_experience", sa.String(length=100), nullable=True))
    op.add_column("job_postings", sa.Column("required_skills", postgresql.ARRAY(sa.String(length=100)), nullable=True))
    op.add_column("job_postings", sa.Column("preferred_skills", postgresql.ARRAY(sa.String(length=100)), nullable=True))
    op.add_column(
        "job_postings",
        sa.Column("employment_type", postgresql.ENUM(name="employment_type_enum", create_type=False), nullable=True),
    )
    op.add_column("job_postings", sa.Column("location_id", sa.UUID(), nullable=True))
    op.add_column("job_postings", sa.Column("salary_min", sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column("job_postings", sa.Column("salary_max", sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column("job_postings", sa.Column("ai_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("job_postings", sa.Column("created_by_id", sa.UUID(), nullable=True))
    op.add_column("job_postings", sa.Column("submitted_for_review_by_id", sa.UUID(), nullable=True))
    op.add_column("job_postings", sa.Column("submitted_for_review_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("job_postings", sa.Column("approved_by_id", sa.UUID(), nullable=True))
    op.add_column("job_postings", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("job_postings", sa.Column("published_by_id", sa.UUID(), nullable=True))

    op.create_foreign_key(
        op.f("fk_job_postings_location_id_locations"), "job_postings", "locations",
        ["location_id"], ["id"], ondelete="RESTRICT",
    )
    for column in _USER_FKS:
        op.create_foreign_key(
            op.f(f"fk_job_postings_{column}_users"), "job_postings", "users", [column], ["id"], ondelete="SET NULL"
        )
    op.alter_column("job_postings", "published_at", existing_type=sa.DateTime(timezone=True), nullable=True)

    # --- backfill existing postings -----------------------------------------
    op.execute(
        """
        UPDATE job_postings jp
        SET required_qualification = vr.qualification,
            required_experience = vr.experience_required,
            required_skills = vr.skills,
            employment_type = vr.employment_type,
            location_id = vr.location_id,
            salary_min = vr.salary_band_min,
            salary_max = vr.salary_band_max
        FROM approved_vacancies av
        JOIN vacancy_requests vr ON vr.id = av.vacancy_request_id
        WHERE av.id = jp.approved_vacancy_id
        """
    )
    op.execute(
        """
        UPDATE job_postings jp
        SET created_by_id = created.actor_user_id
        FROM (
            SELECT DISTINCT ON (entity_id) entity_id, actor_user_id
            FROM audit_logs
            WHERE action = 'JOB_POSTING_CREATED' AND entity_type = 'JobPosting'
            ORDER BY entity_id, created_at
        ) created
        WHERE created.entity_id = jp.id AND jp.created_by_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE job_postings jp
        SET created_by_id = av.approved_by_id
        FROM approved_vacancies av
        WHERE av.id = jp.approved_vacancy_id AND jp.created_by_id IS NULL
        """
    )
    op.execute(
        "UPDATE job_postings SET published_by_id = created_by_id "
        "WHERE published_by_id IS NULL AND published_at IS NOT NULL"
    )

    # --- grants -------------------------------------------------------------
    for label in ("APPROVE_JOB_POSTING", "PUBLISH_JOB_POSTING"):
        op.execute(
            f"""
            INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
            SELECT gen_random_uuid(), u.id, '{label}', NULL, now()
            FROM users u
            WHERE u.role = 'HR_ADMIN'
              AND NOT EXISTS (
                  SELECT 1 FROM user_permission_grants x WHERE x.user_id = u.id AND x.permission = '{label}'
              )
            """
        )
    op.execute(
        """
        INSERT INTO user_permission_grants (id, user_id, permission, granted_by_id, granted_at)
        SELECT gen_random_uuid(), g.user_id, 'PUBLISH_JOB_POSTING', g.granted_by_id, now()
        FROM user_permission_grants g
        WHERE g.permission = 'PUBLISH_VACANCY'
          AND NOT EXISTS (
              SELECT 1 FROM user_permission_grants x
              WHERE x.user_id = g.user_id AND x.permission = 'PUBLISH_JOB_POSTING'
          )
        """
    )

    # --- external channels become manual-assisted ----------------------------
    op.execute(
        f"""
        UPDATE recruitment_channels
        SET mode = 'MANUAL_ASSISTED', integration_path = NULL, updated_at = now()
        WHERE code IN {_MANUAL_CODES} AND mode = 'API'
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE recruitment_channels
        SET mode = 'API', integration_path = 'job-distribution', updated_at = now()
        WHERE code IN {_MANUAL_CODES} AND mode = 'MANUAL_ASSISTED'
        """
    )
    op.execute("DELETE FROM user_permission_grants WHERE permission IN ('APPROVE_JOB_POSTING', 'PUBLISH_JOB_POSTING')")
    # The pre-review code has no draft states: a posting that never went live
    # is closed, and every posting needs a publication date again.
    op.execute(
        "UPDATE job_postings SET status = 'CLOSED', is_active = false, closed_at = coalesce(closed_at, now()) "
        "WHERE status IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED')"
    )
    op.execute("UPDATE job_postings SET published_at = created_at WHERE published_at IS NULL")
    op.alter_column("job_postings", "published_at", existing_type=sa.DateTime(timezone=True), nullable=False)

    for column in _USER_FKS:
        op.drop_constraint(op.f(f"fk_job_postings_{column}_users"), "job_postings", type_="foreignkey")
    op.drop_constraint(op.f("fk_job_postings_location_id_locations"), "job_postings", type_="foreignkey")
    for column in (
        "published_by_id", "approved_at", "approved_by_id", "submitted_for_review_at", "submitted_for_review_by_id",
        "created_by_id", "ai_generated_at", "salary_max", "salary_min", "location_id", "employment_type",
        "preferred_skills", "required_skills", "required_experience", "required_qualification",
        "responsibilities", "summary",
    ):
        op.drop_column("job_postings", column)
