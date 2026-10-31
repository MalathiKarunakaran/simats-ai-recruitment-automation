"""audit_logs entity lookup index

Revision ID: 9e1a3c5b7d46
Revises: 8d4f6b0c2e35
Create Date: 2026-10-31

Pipeline brief Phase 6, decision B ("Last updated by"): the newest audit row
per (entity_type, entity_id) is looked up for a whole page of applications at
once. audit_logs.entity_id had no index; this composite one serves the join
and the newest-first ordering. Index only, so downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9e1a3c5b7d46"
down_revision: Union[str, Sequence[str], None] = "8d4f6b0c2e35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_audit_logs_entity_type_entity_id_created_at"


def upgrade() -> None:
    op.create_index(
        _INDEX,
        "audit_logs",
        ["entity_type", "entity_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="audit_logs")
