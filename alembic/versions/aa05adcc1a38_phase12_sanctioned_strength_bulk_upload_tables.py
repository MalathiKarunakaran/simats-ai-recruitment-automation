"""phase12_sanctioned_strength_bulk_upload_tables

Revision ID: aa05adcc1a38
Revises: e2f3a4b5c6d7
Create Date: 2026-08-10 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'aa05adcc1a38'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _staff_role_category_enum() -> postgresql.ENUM:
    # staff_role_category_enum already exists (08d365f809c1_phase2_...) --
    # create_type=False so this migration doesn't try (and fail) to CREATE
    # TYPE a second time.
    return postgresql.ENUM(
        'TEACHING', 'NON_TEACHING', 'HOUSEKEEPING', name='staff_role_category_enum', create_type=False
    )


def upgrade() -> None:
    """Upgrade schema.

    Three new tables for Sanctioned Strength (zany-snuggling-pie.md Phase
    A) -- created in dependency order so every FK is satisfiable within this
    one migration: bulk_upload_log first (no FKs to the other two new
    tables), then sanctioned_strength (references campuses/departments/
    designations/users only), then sanctioned_strength_history last (the
    only one of the three that references both of the other two).
    """
    op.create_table(
        'bulk_upload_log',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('uploaded_by_id', sa.UUID(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('rows_total', sa.Integer(), nullable=False),
        sa.Column('rows_created', sa.Integer(), nullable=False),
        sa.Column('rows_updated', sa.Integer(), nullable=False),
        sa.Column('rows_rejected', sa.Integer(), nullable=False),
        sa.Column('stored_file_object_key', sa.String(length=255), nullable=True),
        sa.Column('status', sa.Enum('COMPLETED', 'UNDONE', name='bulk_upload_status_enum'), nullable=False),
        sa.Column('undo_deadline', sa.DateTime(timezone=True), nullable=False),
        sa.Column('undone_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('undone_by_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ['undone_by_id'], ['users.id'], name=op.f('fk_bulk_upload_log_undone_by_id_users'), ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(
            ['uploaded_by_id'], ['users.id'], name=op.f('fk_bulk_upload_log_uploaded_by_id_users'), ondelete='RESTRICT'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_bulk_upload_log')),
    )

    op.create_table(
        'sanctioned_strength',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('campus_id', sa.UUID(), nullable=False),
        sa.Column('department_id', sa.UUID(), nullable=False),
        sa.Column('designation_id', sa.UUID(), nullable=False),
        sa.Column('category', _staff_role_category_enum(), nullable=False),
        sa.Column('approved_strength', sa.Integer(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by_id', sa.UUID(), nullable=False),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            'approved_strength >= 0', name=op.f('ck_sanctioned_strength_approved_strength_nonneg')
        ),
        sa.ForeignKeyConstraint(
            ['campus_id'], ['campuses.id'], name=op.f('fk_sanctioned_strength_campus_id_campuses'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['created_by_id'], ['users.id'], name=op.f('fk_sanctioned_strength_created_by_id_users'), ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['department_id'], ['departments.id'], name=op.f('fk_sanctioned_strength_department_id_departments'),
            ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['designation_id'], ['designations.id'], name=op.f('fk_sanctioned_strength_designation_id_designations'),
            ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['updated_by_id'], ['users.id'], name=op.f('fk_sanctioned_strength_updated_by_id_users'), ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sanctioned_strength')),
        sa.UniqueConstraint(
            'campus_id', 'department_id', 'designation_id', 'effective_from',
            name='uq_sanctioned_strength_key_effective_from',
        ),
    )
    op.create_index(op.f('ix_sanctioned_strength_campus_id'), 'sanctioned_strength', ['campus_id'], unique=False)
    op.create_index(op.f('ix_sanctioned_strength_department_id'), 'sanctioned_strength', ['department_id'], unique=False)
    op.create_index(op.f('ix_sanctioned_strength_designation_id'), 'sanctioned_strength', ['designation_id'], unique=False)

    op.create_table(
        'sanctioned_strength_history',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('sanctioned_strength_id', sa.UUID(), nullable=False),
        sa.Column('old_value', sa.Integer(), nullable=True),
        sa.Column('new_value', sa.Integer(), nullable=False),
        sa.Column('changed_by_id', sa.UUID(), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('source', sa.Enum('MANUAL', 'BULK_UPLOAD', name='sanctioned_strength_change_source_enum'), nullable=False),
        sa.Column('bulk_upload_log_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ['bulk_upload_log_id'], ['bulk_upload_log.id'],
            name=op.f('fk_sanctioned_strength_history_bulk_upload_log_id_bulk_upload_log'), ondelete='SET NULL',
        ),
        sa.ForeignKeyConstraint(
            ['changed_by_id'], ['users.id'], name=op.f('fk_sanctioned_strength_history_changed_by_id_users'),
            ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['sanctioned_strength_id'], ['sanctioned_strength.id'],
            name=op.f('fk_sanctioned_strength_history_sanctioned_strength_id_sanctioned_strength'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sanctioned_strength_history')),
    )
    op.create_index(
        op.f('ix_sanctioned_strength_history_bulk_upload_log_id'), 'sanctioned_strength_history',
        ['bulk_upload_log_id'], unique=False,
    )
    op.create_index(
        op.f('ix_sanctioned_strength_history_sanctioned_strength_id'), 'sanctioned_strength_history',
        ['sanctioned_strength_id'], unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_sanctioned_strength_history_sanctioned_strength_id'), table_name='sanctioned_strength_history')
    op.drop_index(op.f('ix_sanctioned_strength_history_bulk_upload_log_id'), table_name='sanctioned_strength_history')
    op.drop_table('sanctioned_strength_history')

    op.drop_index(op.f('ix_sanctioned_strength_designation_id'), table_name='sanctioned_strength')
    op.drop_index(op.f('ix_sanctioned_strength_department_id'), table_name='sanctioned_strength')
    op.drop_index(op.f('ix_sanctioned_strength_campus_id'), table_name='sanctioned_strength')
    op.drop_table('sanctioned_strength')

    op.drop_table('bulk_upload_log')

    # staff_role_category_enum is NOT dropped -- shared with other tables
    # that still exist after this downgrade. sanctioned_strength_change_source_enum
    # and bulk_upload_status_enum WERE created fresh by this migration (only
    # ever used by the two tables just dropped), so they are dropped here --
    # same "DROP TABLE doesn't drop the enum type" gap documented in
    # 08d365f809c1_phase2_vacancy_pipeline_offers_joining.py's downgrade().
    bind = op.get_bind()
    sa.Enum(name='sanctioned_strength_change_source_enum').drop(bind, checkfirst=True)
    sa.Enum(name='bulk_upload_status_enum').drop(bind, checkfirst=True)
