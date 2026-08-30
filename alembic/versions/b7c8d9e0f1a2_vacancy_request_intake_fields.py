"""Add VacancyRequest intake fields: source, request_ref, location_id,
required_by, and the three requester_* columns.

Backs the three intake methods (single entry / bulk upload / public QR form).
Every column is additive and every existing row keeps its behaviour:

- `source` is NOT NULL but ships with a MANUAL server_default, so all
  pre-existing rows backfill as MANUAL with no data migration. That default
  stays on the column afterwards rather than being dropped, so a plain
  `INSERT` from anywhere that has not been taught about this column is still
  valid rather than failing on a NOT NULL violation.
- Everything else is nullable, so nothing needs a value.

`request_ref` is UNIQUE and deliberately separate from the existing
`external_ref`, which is the tracker workbook's own Request ID and is what
lets a tracker re-import upsert. Sharing one column would let a QR submission
collide with a tracker row.

`location_id` uses ondelete=RESTRICT, matching every other location_id FK in
this schema -- a Location referenced by a live request must not be deletable
out from under it.

Downgrade drops all seven columns and the enum type, losing every recorded
requester detail and request reference; those exist nowhere else.

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

_SOURCE_ENUM_NAME = "vacancy_request_source_enum"
_SOURCE_VALUES = ("MANUAL", "BULK_UPLOAD", "QR")


def upgrade() -> None:
    source_enum = sa.Enum(*_SOURCE_VALUES, name=_SOURCE_ENUM_NAME)
    # create_type=False on the column below: the type is created once here,
    # explicitly, rather than implicitly by the first add_column -- the
    # implicit path is what makes a downgrade/upgrade cycle fail with
    # "type already exists".
    source_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "vacancy_requests",
        sa.Column(
            "source",
            sa.Enum(*_SOURCE_VALUES, name=_SOURCE_ENUM_NAME, create_type=False),
            nullable=False,
            server_default="MANUAL",
        ),
    )
    op.create_index("ix_vacancy_requests_source", "vacancy_requests", ["source"])

    op.add_column("vacancy_requests", sa.Column("request_ref", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_vacancy_requests_request_ref", "vacancy_requests", ["request_ref"])

    op.add_column("vacancy_requests", sa.Column("location_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_vacancy_requests_location_id",
        "vacancy_requests",
        "locations",
        ["location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_vacancy_requests_location_id", "vacancy_requests", ["location_id"])

    op.add_column("vacancy_requests", sa.Column("required_by", sa.Date(), nullable=True))
    op.add_column("vacancy_requests", sa.Column("requester_name", sa.String(length=150), nullable=True))
    op.add_column("vacancy_requests", sa.Column("requester_email", sa.String(length=255), nullable=True))
    op.add_column("vacancy_requests", sa.Column("requester_mobile", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("vacancy_requests", "requester_mobile")
    op.drop_column("vacancy_requests", "requester_email")
    op.drop_column("vacancy_requests", "requester_name")
    op.drop_column("vacancy_requests", "required_by")

    op.drop_index("ix_vacancy_requests_location_id", table_name="vacancy_requests")
    op.drop_constraint("fk_vacancy_requests_location_id", "vacancy_requests", type_="foreignkey")
    op.drop_column("vacancy_requests", "location_id")

    op.drop_constraint("uq_vacancy_requests_request_ref", "vacancy_requests", type_="unique")
    op.drop_column("vacancy_requests", "request_ref")

    op.drop_index("ix_vacancy_requests_source", table_name="vacancy_requests")
    op.drop_column("vacancy_requests", "source")
    sa.Enum(name=_SOURCE_ENUM_NAME).drop(op.get_bind(), checkfirst=True)
