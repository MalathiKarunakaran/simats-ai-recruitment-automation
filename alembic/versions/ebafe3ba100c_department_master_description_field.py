"""department_master_description_field

Revision ID: ebafe3ba100c
Revises: e5a4d57be056
Create Date: 2026-08-25 23:01:35.507700

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'ebafe3ba100c'
down_revision: Union[str, Sequence[str], None] = 'e5a4d57be056'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Department Master hardening epic (backend Phase 1, 2026-08-25): adds a
    free-text `description` column, mirrored on `parent_group`'s own
    nullable/optional shape (no backfill requirement).

    Deliberately does NOT add `UniqueConstraint("campus_id", "code")` here --
    the epic's brief called for it, but a live-data check against the real
    dev DB before writing this migration found a genuine pre-existing
    collision: campus SHIFT (id 60cb83d4-be33-4cff-ae05-169f45a84dff) has 3
    active departments all sharing `code='SHIFT'` (HOTEL MANAGEMENT, CHEF,
    SHIFT PRINCIPAL OFFICE -- apparently the campus's own code was reused as
    each department's code by mistake). Adding the constraint now would fail
    outright against this data. Per the brief's own explicit instruction
    ("if some do exist, STOP and report... rather than either silently
    corrupting data or guessing which duplicate to keep/rename"), this is
    intentionally left for a human decision (rename 2 of the 3 codes, or
    clear them) before a follow-up migration can add the real DB constraint.
    In the meantime, `app/api/v1/routers/departments.py`'s own
    create/update Code+Campus uniqueness check (400, app-level, not a DB
    constraint) prevents any *new* collision from being introduced via the
    API or bulk upload while this pre-existing trio remains unresolved.

    Autogenerate also picked up unrelated pre-existing server_default/index-
    vs-unique-constraint drift on other tables (applications, candidates,
    designations, eligibility_rules, employees, housekeeping_staff,
    locations, pipeline_stage_configs, sanctioned_strength, vacancy_requests)
    that predates this change -- deliberately excluded from this migration,
    same call as every prior migration in this epic that hit the same
    pre-existing drift (see e.g. 5029a5d385c8_phase_j_bulk_upload_entity_type_
    and_row_.py's own docstring).
    """
    op.add_column('departments', sa.Column('description', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('departments', 'description')
