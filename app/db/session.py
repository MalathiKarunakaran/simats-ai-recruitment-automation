from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

# pool_size/max_overflow tuned (not just raised) after Phase 7 load
# testing: SQLAlchemy's defaults (5/10) caused a multi-second p99 tail
# latency under 50 concurrent single-process requests. But this engine is
# constructed once *per worker process* -- an initial attempt at 30/20 (50
# per worker) caused real errors at --workers 4, because 4 x 50 = 200
# attempted connections against Postgres's own default max_connections=100.
# 10/10 (20 per worker) x 4 workers = 80, leaving headroom under 100. If a
# production deploy runs more workers, raise Postgres's max_connections to
# match (documented in DEPLOYMENT.md) rather than raising this further.
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10)
# autoflush=True (SQLAlchemy's default) so a query within a transaction
# always sees that same transaction's own pending writes -- e.g. Module 11's
# pipeline service reserves a HiringSlot then, in a later call within the
# same request, re-queries for that reservation; without autoflush this can
# silently read stale pre-write state.
SessionLocal = sessionmaker(autocommit=False, autoflush=True, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
