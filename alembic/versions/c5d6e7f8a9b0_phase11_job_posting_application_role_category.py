"""phase11_job_posting_application_role_category

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8
Create Date: 2026-08-10 00:00:03.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _role_category_enum() -> postgresql.ENUM:
    # staff_role_category_enum already exists (created in
    # 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py for
    # vacancy_requests.role_category) and already has all three values
    # needed here -- create_type=False so this migration doesn't try (and
    # fail) to CREATE TYPE a second time. No ALTER TYPE ADD VALUE gotcha.
    return postgresql.ENUM(
        'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
    )


def upgrade() -> None:
    """Upgrade schema."""
    # JobPosting.role_category -- denormalized from
    # approved_vacancy.vacancy_request.role_category, same rationale as
    # JobPosting.campus_id, for cheap filtering without a join.
    op.add_column('job_postings', sa.Column('role_category', _role_category_enum(), nullable=True))
    op.execute(
        """
        UPDATE job_postings jp
        SET role_category = vr.role_category
        FROM approved_vacancies av
        JOIN vacancy_requests vr ON vr.id = av.vacancy_request_id
        WHERE jp.approved_vacancy_id = av.id
        """
    )
    op.alter_column('job_postings', 'role_category', nullable=False)
    op.create_index(op.f('ix_job_postings_role_category'), 'job_postings', ['role_category'], unique=False)

    # Application.role_category -- denormalized from job_posting.role_category,
    # same rationale as Application.campus_id.
    op.add_column('applications', sa.Column('role_category', _role_category_enum(), nullable=True))
    op.execute(
        """
        UPDATE applications a
        SET role_category = jp.role_category
        FROM job_postings jp
        WHERE a.job_posting_id = jp.id
        """
    )
    op.alter_column('applications', 'role_category', nullable=False)
    op.create_index(op.f('ix_applications_role_category'), 'applications', ['role_category'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_applications_role_category'), table_name='applications')
    op.drop_column('applications', 'role_category')

    op.drop_index(op.f('ix_job_postings_role_category'), table_name='job_postings')
    op.drop_column('job_postings', 'role_category')

    # staff_role_category_enum is NOT dropped here -- shared with
    # vacancy_requests.role_category/designations.category/departments.category,
    # all of which still exist after this downgrade.
