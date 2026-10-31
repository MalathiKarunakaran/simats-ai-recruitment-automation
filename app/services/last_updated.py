"""'Last updated by' for applications (pipeline brief Phase 6, decision B).

Nothing stores an `updated_by_id`; the who is already in `audit_logs`. What
"last updated" means for an application: the newest audit row whose entity is
the application itself (creation, every status move through
`pipeline.transition_application_status`, pipeline-details edits, screening flags,
department-allotment overrides) OR one of the joining-stage records that hang off it --
its JoiningRecord, JoiningDocuments, AppointmentOrder (the provisional order),
HodReviews and PermanentOrder.

Deliberately NOT included: Offer and InterviewSchedule/Feedback rows (their
status effects already reach the application as an 'Application' audit row
through the pipeline), and the sheet-synced ProvisionalOrder checklist marks,
which belong to a sheet row with no link to an application.

An audit row with no actor (a system or sync write, or an actor since
deleted) comes back with name None; the UI shows that as "System".
"""

import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy import String, and_, literal, select, union_all
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.appointment_order import AppointmentOrder
from app.models.audit_log import AuditLog
from app.models.hod_review import HodReview
from app.models.joining import JoiningDocument, JoiningRecord
from app.models.permanent_order import PermanentOrder
from app.models.user import User

try:  # SQLAlchemy 2.1+: DISTINCT ON is a dialect extension
    from sqlalchemy.dialects.postgresql import distinct_on
except ImportError:  # pragma: no cover - 2.0.x, which requirements.txt still allows
    distinct_on = None

# (audit entity_type, model) for every record whose audit rows count as an
# update to the application it belongs to. Each model has `application_id`.
_LINKED_ENTITIES = (
    ("JoiningRecord", JoiningRecord),
    ("JoiningDocument", JoiningDocument),
    ("AppointmentOrder", AppointmentOrder),
    ("HodReview", HodReview),
    ("PermanentOrder", PermanentOrder),
)


def last_updated_by(
    db: Session, application_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, tuple[str | None, datetime]]:
    """{application_id: (actor full name or None, audit created_at)} for every
    id that has at least one audit row. One query, however many ids."""
    ids = list(dict.fromkeys(application_ids))
    if not ids:
        return {}

    links = union_all(
        select(
            literal("Application", String).label("entity_type"),
            Application.id.label("entity_id"),
            Application.id.label("application_id"),
        ).where(Application.id.in_(ids)),
        *(
            select(
                literal(entity_type, String).label("entity_type"),
                model.id.label("entity_id"),
                model.application_id.label("application_id"),
            ).where(model.application_id.in_(ids))
            for entity_type, model in _LINKED_ENTITIES
        ),
    ).subquery("links")

    stmt = (
        select(links.c.application_id, User.full_name, AuditLog.created_at)
        .join(
            AuditLog,
            and_(AuditLog.entity_type == links.c.entity_type, AuditLog.entity_id == links.c.entity_id),
        )
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .order_by(links.c.application_id, AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    # One row per application: the newest audit row by the ORDER BY above.
    stmt = stmt.ext(distinct_on(links.c.application_id)) if distinct_on else stmt.distinct(links.c.application_id)
    return {row.application_id: (row.full_name, row.created_at) for row in db.execute(stmt)}
