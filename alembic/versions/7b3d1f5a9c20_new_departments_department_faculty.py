"""new departments, department faculty (sheet sync S5)

Revision ID: 7b3d1f5a9c20
Revises: 5a8c2e9f4b17
Create Date: 2026-10-31

docs/specs/joinee-order-sync.md, S5: two new tables, nothing existing
changed. States are plain strings, so downgrade is a clean drop.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7b3d1f5a9c20"
down_revision: Union[str, Sequence[str], None] = "5a8c2e9f4b17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id():
    return sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _stamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def _s(name, n):
    return sa.Column(name, sa.String(length=n), nullable=True)


def _i(name):
    return sa.Column(name, sa.Integer(), nullable=True)


def _b(name):
    return sa.Column(name, sa.Boolean(), server_default="false", nullable=False)


def _common():
    return [
        sa.Column("row_key", sa.String(length=64), nullable=False),
        _s("content_hash", 64),
        _i("sheet_row_number"),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "new_departments",
        _id(),
        *_common(),
        _s("name", 255), _s("notes", 255),
        _i("count"), _s("count_raw", 100), _i("additional_count"), _s("additional_count_raw", 100),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        *_stamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("row_key", name="uq_new_departments_row_key"),
    )
    op.create_index("ix_new_departments_is_active", "new_departments", ["is_active"])

    op.create_table(
        "department_faculty",
        _id(),
        *_common(),
        _s("bio_id", 100), _s("full_name", 255), _s("dept_raw", 255), _s("remark_raw", 100), _s("role", 10),
        _s("status_raw", 100), _b("is_additional"), _s("top25_raw", 100), _b("top_dept"),
        _s("employment_state", 20), _s("parent_dept_note", 100), _s("vacancy_raw", 255), _s("active_raw", 255),
        sa.Column("new_department_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sheet_joinee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        *_stamps(),
        sa.ForeignKeyConstraint(["new_department_id"], ["new_departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sheet_joinee_id"], ["sheet_joinees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("row_key", name="uq_department_faculty_row_key"),
    )
    for col in ("is_active", "bio_id", "role", "employment_state", "new_department_id", "sheet_joinee_id"):
        op.create_index(f"ix_department_faculty_{col}", "department_faculty", [col])


def downgrade() -> None:
    op.drop_table("department_faculty")
    op.drop_table("new_departments")
