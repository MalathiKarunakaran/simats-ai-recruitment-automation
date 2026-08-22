import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Make the app package importable when Alembic is invoked from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402  (imports every model for metadata registration)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Real DB URL comes from app settings (.env), never from a tracked ini file.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            # Each migration commits independently rather than the whole
            # `alembic upgrade` invocation running as one giant transaction.
            # Discovered live during the first fresh-database deploy: several
            # migrations do `ALTER TYPE ... ADD VALUE` and a LATER migration
            # (not necessarily the very next one -- e.g.
            # add_recruitment_coordinator_role's new value is read by
            # permission_matrix_schema_and_backfill, many revisions later)
            # references that new value in a DML statement. Postgres refuses
            # to use a new enum value until it's committed
            # ("UnsafeNewEnumValueUsage"), which only ever manifested when
            # `alembic upgrade head` ran as a single command from an empty
            # database -- every prior verification (local dev, the test
            # suite) ran against a database with history applied
            # incrementally over time, so each ADD VALUE was already long
            # committed by the time anything used it. Per-migration
            # transactions is Alembic's own documented fix for this class of
            # problem and is the more conventional default besides (matches
            # how most other migration tools behave) -- also makes a failed
            # deploy resumable from exactly where it stopped, rather than
            # rolling back everything since the last manual checkpoint.
            transaction_per_migration=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
