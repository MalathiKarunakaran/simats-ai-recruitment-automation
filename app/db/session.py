from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
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
