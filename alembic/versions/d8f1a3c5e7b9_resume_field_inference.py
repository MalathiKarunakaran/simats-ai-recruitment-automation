"""resume field inference provenance

Revision ID: d8f1a3c5e7b9
Revises: c6e8a0b2d4f6
Create Date: 2026-11-09

Additive only. Records HOW each resume-derived gender/state was reached
(source, confidence, evidence), a hash of the resume read, and a frozen copy
of the original reader's values (legacy_*) so the sheet-only view keeps
reproducing the pre-inference numbers. Existing rows are backfilled:
a stored gender is an explicit-field reading, a stored state a home-address one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8f1a3c5e7b9"
down_revision: Union[str, Sequence[str], None] = "c6e8a0b2d4f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "talent_pool_resume_fields"
_COLUMNS = [
    ("gender_source", sa.String(length=30)),
    ("gender_confidence", sa.String(length=10)),
    ("gender_evidence", sa.String(length=200)),
    ("state_source", sa.String(length=30)),
    ("state_confidence", sa.String(length=10)),
    ("state_evidence", sa.String(length=200)),
    ("resume_hash", sa.String(length=64)),
    ("inferred_at", sa.DateTime(timezone=True)),
    ("legacy_gender", sa.String(length=20)),
    ("legacy_state", sa.String(length=100)),
    ("legacy_country", sa.String(length=100)),
]


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column(_TABLE, sa.Column(name, type_, nullable=True))
    op.create_index(op.f("ix_talent_pool_resume_fields_resume_hash"), _TABLE, ["resume_hash"])
    op.execute(
        f"UPDATE {_TABLE} SET gender_source = 'resume_field', gender_confidence = 'high' WHERE gender IS NOT NULL"
    )
    op.execute(f"UPDATE {_TABLE} SET state_source = 'resume_address' WHERE state IS NOT NULL")
    op.execute(f"UPDATE {_TABLE} SET legacy_gender = gender, legacy_state = state, legacy_country = country")


def downgrade() -> None:
    op.drop_index(op.f("ix_talent_pool_resume_fields_resume_hash"), table_name=_TABLE)
    for name, _ in reversed(_COLUMNS):
        op.drop_column(_TABLE, name)
