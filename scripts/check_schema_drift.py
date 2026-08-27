"""Fail if the Alembic migration chain and the SQLAlchemy models disagree.

Production builds its schema by running migrations
(`scripts/docker-entrypoint.sh` runs `alembic upgrade head` on every deploy),
while the test suite builds its schema from `Base.metadata.create_all`
(tests/conftest.py). Nothing else checks that those two agree -- so a model
column added without a migration passes the whole test suite and then fails at
runtime in production. This closes that gap.

Run against a database already migrated to head.

**Known false positive, deliberately filtered:** Postgres implements a
`UNIQUE` constraint using a unique index, and alembic's autogenerate cannot
reliably tell a `unique=True` Index apart from a UniqueConstraint. Every
`String(..., unique=True)` column in this codebase therefore shows up as a
`remove_index` + `add_constraint` pair on the same column even when the schema
is perfectly correct (verified 2026-08-27 against a clean `upgrade head`
database: 4 such pairs, 0 real differences). Those matched pairs are dropped;
anything else -- including an *unmatched* index or constraint change -- is
still reported and still fails.
"""

import sys

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.core.config import settings
from app.db.base import Base  # noqa: F401 -- registers every model on Base.metadata


def _columns(obj) -> tuple:
    try:
        return tuple(sorted(column.name for column in obj.columns))
    except Exception:  # pragma: no cover - defensive, shape varies by alembic version
        return ()


def _table(obj) -> str:
    table = getattr(obj, "table", None)
    return getattr(table, "name", "") if table is not None else ""


def filter_unique_index_noise(diff: list) -> list:
    """Drop matched (remove_index unique=True, add_constraint UNIQUE) pairs
    covering the same table+columns. An unmatched half is kept: that one is
    a real difference, not the Postgres unique-index artifact."""
    removed_unique_indexes = {
        (_table(entry[1]), _columns(entry[1]))
        for entry in diff
        if entry[0] == "remove_index" and getattr(entry[1], "unique", False)
    }
    added_unique_constraints = {
        (_table(entry[1]), _columns(entry[1])) for entry in diff if entry[0] == "add_constraint"
    }
    paired = removed_unique_indexes & added_unique_constraints

    kept = []
    for entry in diff:
        key = (_table(entry[1]), _columns(entry[1])) if len(entry) > 1 else None
        if key in paired and entry[0] in ("remove_index", "add_constraint"):
            continue
        kept.append(entry)
    return kept


def main() -> int:
    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    real = filter_unique_index_noise(list(diff))
    ignored = len(diff) - len(real)
    if ignored:
        print(f"Ignored {ignored} known unique-index/unique-constraint artifact(s).")

    if real:
        print("::error::Migrations and models disagree -- a migration is probably missing:")
        for entry in real:
            print("   ", entry)
        return 1

    print("Migrations and models agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
