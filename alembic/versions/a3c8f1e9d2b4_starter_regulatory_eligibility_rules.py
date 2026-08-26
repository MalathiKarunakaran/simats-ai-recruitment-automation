"""starter_regulatory_eligibility_rules

Revision ID: a3c8f1e9d2b4
Revises: f7c1a2b3d4e5
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a3c8f1e9d2b4'
down_revision: Union[str, Sequence[str], None] = 'f7c1a2b3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Starter regulatory-eligibility-rules feature (backend Phase 1) --
    extends `eligibility_rules` with 19 new, all-additive columns (department
    scoping, regulatory-authority mapping, and a large batch of mostly-
    descriptive regulatory fields), plus a new 'ELIGIBILITY_RULE' value on
    the already-live `bulk_upload_entity_type_enum` so EligibilityRule bulk
    uploads can be recorded on `BulkUploadLog.entity_type`/
    `BulkUploadRowLog.entity_type` alongside SANCTIONED_STRENGTH/LOCATION/
    HOUSEKEEPING_STAFF/DEPARTMENT.

    None of the pre-existing columns (is_active, notes, net_set_required,
    position_title, staff_category, campus_id, required_qualification_keyword,
    etc.) change shape or meaning -- see app/models/eligibility_rule.py's own
    docstring, and app/services/eligibility.py::check_qualification_mismatch
    (completely unchanged by this migration; it never reads any of the new
    columns).

    Two brand-new native enum types (`regulatory_authority_enum`,
    `eligibility_rule_status_enum`) are created fresh here for 2 of the new
    columns -- unlike the `bulk_upload_entity_type_enum` ADD VALUE below,
    these can be cleanly DROPped in downgrade() (see
    5029a5d385c8_phase_j_bulk_upload_entity_type_and_row_.py for the same
    "type created fresh in this migration" precedent). Unlike that migration
    (whose `create_table` calls implicitly emit `CREATE TYPE` as part of
    `CREATE TABLE`), every column here is added via a standalone
    `op.add_column` on the pre-existing `eligibility_rules` table, and
    `ALTER TABLE ... ADD COLUMN` does NOT implicitly `CREATE TYPE` the way
    `CREATE TABLE` does -- so both new types are created explicitly with
    `postgresql.ENUM(...).create(bind, checkfirst=True)` before the columns
    that use them, and referenced with `create_type=False` in the `Column`
    definitions themselves (same `create_type=False` convention as
    0490bbdbc543_phase10_department_master_fields.py's own reuse of an
    existing type, just for a type this migration itself just created rather
    than a pre-existing one). The ADD VALUE onto `bulk_upload_entity_type_enum`
    is safe in this same migration because nothing in this same upgrade()
    writes a row using the new 'ELIGIBILITY_RULE' label -- same precedent as
    f7c1a2b3d4e5_bulk_upload_department_entity_type.py.
    """
    op.execute("ALTER TYPE bulk_upload_entity_type_enum ADD VALUE IF NOT EXISTS 'ELIGIBILITY_RULE'")

    op.add_column('eligibility_rules', sa.Column('department_id', sa.UUID(), nullable=True))
    op.create_index(
        op.f('ix_eligibility_rules_department_id'), 'eligibility_rules', ['department_id'], unique=False
    )
    op.create_foreign_key(
        op.f('fk_eligibility_rules_department_id_departments'),
        'eligibility_rules',
        'departments',
        ['department_id'],
        ['id'],
        ondelete='RESTRICT',
    )

    bind = op.get_bind()
    postgresql.ENUM(
        'AICTE_UGC', 'COA', 'UGC', 'UGC_AICTE_INSTITUTION', 'NCTE_UGC',
        'INSTITUTION_NON_TEACHING', 'INSTITUTION_HR_HOUSEKEEPING', 'UNMAPPED_VERIFY',
        name='regulatory_authority_enum',
    ).create(bind, checkfirst=True)
    postgresql.ENUM('DRAFT', 'ACTIVE', 'ARCHIVED', name='eligibility_rule_status_enum').create(bind, checkfirst=True)

    op.add_column(
        'eligibility_rules',
        sa.Column(
            'regulatory_authority',
            postgresql.ENUM(
                'AICTE_UGC', 'COA', 'UGC', 'UGC_AICTE_INSTITUTION', 'NCTE_UGC',
                'INSTITUTION_NON_TEACHING', 'INSTITUTION_HR_HOUSEKEEPING', 'UNMAPPED_VERIFY',
                name='regulatory_authority_enum', create_type=False,
            ),
            nullable=True,
        ),
    )
    op.add_column('eligibility_rules', sa.Column('school_or_college', sa.String(length=200), nullable=True))
    op.add_column('eligibility_rules', sa.Column('programme_discipline', sa.String(length=200), nullable=True))
    op.add_column('eligibility_rules', sa.Column('minimum_qualification', sa.Text(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('minimum_percentage', sa.String(length=100), nullable=True))
    op.add_column('eligibility_rules', sa.Column('required_experience', sa.String(length=200), nullable=True))
    op.add_column('eligibility_rules', sa.Column('required_credential', sa.String(length=300), nullable=True))
    op.add_column('eligibility_rules', sa.Column('required_keywords', sa.Text(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('preferred_keywords', sa.Text(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('phd_required', sa.Boolean(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('professional_registration', sa.String(length=300), nullable=True))
    op.add_column('eligibility_rules', sa.Column('industry_experience', sa.String(length=200), nullable=True))
    op.add_column('eligibility_rules', sa.Column('priority', sa.String(length=50), nullable=True))
    op.add_column('eligibility_rules', sa.Column('effective_from', sa.Date(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('effective_to', sa.Date(), nullable=True))
    op.add_column('eligibility_rules', sa.Column('source_regulation', sa.Text(), nullable=True))
    op.add_column(
        'eligibility_rules',
        sa.Column(
            'status',
            postgresql.ENUM('DRAFT', 'ACTIVE', 'ARCHIVED', name='eligibility_rule_status_enum', create_type=False),
            server_default='DRAFT',
            nullable=False,
        ),
    )
    op.add_column(
        'eligibility_rules',
        sa.Column('verification_required', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('eligibility_rules', 'verification_required')
    op.drop_column('eligibility_rules', 'status')
    op.drop_column('eligibility_rules', 'source_regulation')
    op.drop_column('eligibility_rules', 'effective_to')
    op.drop_column('eligibility_rules', 'effective_from')
    op.drop_column('eligibility_rules', 'priority')
    op.drop_column('eligibility_rules', 'industry_experience')
    op.drop_column('eligibility_rules', 'professional_registration')
    op.drop_column('eligibility_rules', 'phd_required')
    op.drop_column('eligibility_rules', 'preferred_keywords')
    op.drop_column('eligibility_rules', 'required_keywords')
    op.drop_column('eligibility_rules', 'required_credential')
    op.drop_column('eligibility_rules', 'required_experience')
    op.drop_column('eligibility_rules', 'minimum_percentage')
    op.drop_column('eligibility_rules', 'minimum_qualification')
    op.drop_column('eligibility_rules', 'programme_discipline')
    op.drop_column('eligibility_rules', 'school_or_college')
    op.drop_column('eligibility_rules', 'regulatory_authority')

    op.drop_constraint(op.f('fk_eligibility_rules_department_id_departments'), 'eligibility_rules', type_='foreignkey')
    op.drop_index(op.f('ix_eligibility_rules_department_id'), table_name='eligibility_rules')
    op.drop_column('eligibility_rules', 'department_id')

    # regulatory_authority_enum / eligibility_rule_status_enum were both
    # created fresh by this migration (only ever used by the columns just
    # dropped), so it's safe to DROP TYPE here -- unlike
    # bulk_upload_entity_type_enum's ADD VALUE 'ELIGIBILITY_RULE' just below,
    # which Postgres has no way to cleanly remove again.
    bind = op.get_bind()
    sa.Enum(name='eligibility_rule_status_enum').drop(bind, checkfirst=True)
    sa.Enum(name='regulatory_authority_enum').drop(bind, checkfirst=True)

    # Postgres has no ALTER TYPE ... DROP VALUE -- the 'ELIGIBILITY_RULE'
    # enum label intentionally stays in place on downgrade, same accepted
    # limitation as f7c1a2b3d4e5_bulk_upload_department_entity_type.py's own
    # downgrade().
