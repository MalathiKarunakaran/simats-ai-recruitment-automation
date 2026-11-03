from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class TalentPoolSourceRef(Base):
    """Where a person came from, per the TS tab's Reference column, so the Final
    tab's "Our Data" can be split by source. One row per email ("e:...") or phone
    ("p:..."). Replaced whole by each sync (services/talent_pool_sources.py) and
    never written back to the sheet."""

    __tablename__ = "talent_pool_source_refs"

    match_key: Mapped[str] = mapped_column(String(320), primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
