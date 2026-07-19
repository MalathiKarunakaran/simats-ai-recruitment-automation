"""Candidate withdrawal (soft-delete-style, one-way).

A Candidate is never hard-deleted (their Applications/Employee records must
remain queryable for audit/reporting), so this mirrors
app/services/employees.py's offboard_employee pattern -- a plain function
with the same audit-logging discipline, not a full state machine.

Withdrawing a candidate must also withdraw every one of their still-open
Applications so any reserved HiringSlot gets released. Application.status is
only ever allowed to move through app/services/pipeline.py
(CLAUDE.md/backend skill), so this cascades through
transition_application_status() rather than touching Application rows
directly.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.candidate import Candidate
from app.models.enums import APPLICATION_TERMINAL_STATUSES, ApplicationStatusEnum
from app.models.user import User
from app.services import pipeline
from app.services.audit import log_update


def withdraw_candidate(
    db: Session,
    *,
    candidate: Candidate,
    reason: str,
    actor: User,
    request: Request | None = None,
) -> Candidate:
    if candidate.is_withdrawn:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Candidate is already withdrawn",
        )

    before = {
        "is_withdrawn": candidate.is_withdrawn,
        "withdrawn_at": None,
        "withdrawn_reason": candidate.withdrawn_reason,
    }
    candidate.is_withdrawn = True
    candidate.withdrawn_at = datetime.now(timezone.utc)
    candidate.withdrawn_reason = reason

    log_update(
        db,
        actor=actor,
        entity_type="Candidate",
        entity=candidate,
        campus_context_id=None,
        before_state=before,
        after_state={
            "is_withdrawn": candidate.is_withdrawn,
            "withdrawn_at": candidate.withdrawn_at.isoformat(),
            "withdrawn_reason": candidate.withdrawn_reason,
        },
        request=request,
    )

    applications = db.query(Application).filter(Application.candidate_id == candidate.id).all()
    for application in applications:
        if application.status in APPLICATION_TERMINAL_STATUSES:
            continue
        pipeline.transition_application_status(
            db,
            application=application,
            new_status=ApplicationStatusEnum.WITHDRAWN,
            actor=actor,
            request=request,
            reason=f"Candidate withdrawn: {reason}",
        )

    return candidate
