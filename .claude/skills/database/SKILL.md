---
name: database
description: SQLAlchemy 2.0 model + Alembic migration conventions for this repo -- native Postgres ENUMs, the ADD VALUE-can't-be-undone gotcha, denormalized campus_id, and the per-worker connection pool sizing. Load when adding/changing a model, writing a migration, or touching app/db/session.py.
---

# Database patterns (SIMATS Recruitment)

## Models (`app/models/`)

One file per entity, SQLAlchemy 2.0 typed style throughout:
`Mapped[T]` / `mapped_column(...)`. Conventions to match exactly:

- Primary keys: `UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()`.
- Enums: every fixed-vocabulary status/role field is a **native Postgres
  ENUM** via `sqlalchemy.Enum(SomePyEnum, name="some_enum")`, backed by a
  Python `str, enum.Enum` class in `app/models/enums.py` — not a plain
  string column with app-level validation. All enum classes and their
  role/status groupings live in that one file (`enums.py`), not scattered
  across model files.
- Foreign keys: explicit `ondelete=` on every FK — `"RESTRICT"` is the
  default choice for most references (e.g. `Application.candidate_id`,
  `.job_posting_id`), `"CASCADE"` for owned child rows (e.g.
  `RefreshToken.user_id`), `"SET NULL"` for optional/nullable references
  (e.g. `AuditLog.actor_user_id`, `Employee.department_id`).
- **Denormalized `campus_id`**: several tables (e.g. `Application.campus_id`,
  copied from `job_posting.campus_id`) store campus_id directly even though
  it's derivable through a join, specifically so campus-scope filtering
  (`app/core/deps.py::CampusScope`) is a cheap indexed `WHERE campus_id = ...`
  instead of a join on every scoped query. Follow this pattern for any new
  table whose rows need campus-scope filtering.
- New models must be imported in `app/models/__init__.py` (or `app/db/base.py`
  depending on which currently aggregates them — check both, they exist for
  Alembic autogenerate to see the full `Base.metadata`) or `alembic revision
  --autogenerate` won't see the table.
- Timestamps: `created_at`/`updated_at` via `server_default=func.now()` /
  `onupdate=func.now()`, not app-side `datetime.utcnow()` defaults.

## Migrations (`alembic/versions/`)

Named roughly one-per-phase (`phase1_initial_schema`,
`phase2_vacancy_pipeline_offers_joining`, `phase3_ai_agents_interviews_...`,
`phase4_application_withdrawn_status`), generated with `alembic revision
--autogenerate -m "..."` then hand-reviewed.

**The Postgres "no DROP VALUE" gotcha** — real example, see
`alembic/versions/023e1b89bbec_phase4_application_withdrawn_status.py`: adding
`WITHDRAWN` to the existing `application_status_enum` type requires
```python
op.execute("ALTER TYPE application_status_enum ADD VALUE IF NOT EXISTS 'WITHDRAWN'")
```
run **outside** any transaction block that also uses the new value (fine as
long as the same migration doesn't write rows using it). Postgres has no
`ALTER TYPE ... DROP VALUE` — so `downgrade()` for this kind of change
**cannot** remove the enum label again; the honest thing (done here) is to
downgrade the added columns but leave a comment explaining the label stays.
This only applies to values added to an *existing* native enum type — an
enum type created fresh for a new column in the same migration can still be
cleanly dropped in `downgrade()` (see the other enum-drop calls in
`08d365f809c1_phase2_...py` for that ordinary case — `DROP TABLE` does not
automatically drop the Postgres enum type it referenced, so `downgrade()`
must drop the type explicitly too).

## Connection pooling (`app/db/session.py`)

```python
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10)
```
`pool_size=10, max_overflow=10` was tuned (not just raised) after Phase 7
load testing. **This is a per-worker-process figure** — the engine is
constructed once per uvicorn worker, so total possible connections is
`workers x 20`. At the default 4 workers (`scripts/docker-entrypoint.sh`)
that's 80, under Postgres's own default `max_connections=100`. If you raise
`UVICORN_WORKERS` significantly, raise Postgres's `max_connections` to match
first (documented in `DEPLOYMENT.md`) — don't just raise `pool_size` further
without doing that math.

`SessionLocal` uses `autoflush=True` (SQLAlchemy's default) deliberately —
`app/services/pipeline.py` re-queries a `HiringSlot` it just reserved within
the same request/transaction; without autoflush that re-query could silently
read stale pre-write state.

## Test schema

`tests/conftest.py` builds the schema via `Base.metadata.create_all()`, not
`alembic upgrade head` — a documented Phase 1 speed trade-off. This means a
model change is picked up by tests immediately without needing a migration
first, but it also means **migrations are not exercised by the test suite at
all** — always manually sanity-check a new migration against a real dev DB
(`alembic upgrade head` / `alembic downgrade -1`).
