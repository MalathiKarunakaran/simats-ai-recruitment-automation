"""Public, UNAUTHENTICATED vacancy-request intake -- 2026-08-30.

This is the only unauthenticated write surface in the application besides
`auth.py`'s login/OTP endpoints, so its boundaries are deliberate and narrow:

- **Two endpoints only.** Read the master data a form needs, and submit one
  request. Nothing here lists, reads back, edits or deletes an existing
  request, so the public surface cannot be used to enumerate anything.
- **Rate limited per IP**, mirroring `auth.py`'s own limiter usage. The
  options endpoint is looser than the submit endpoint, because filling a form
  legitimately involves reading it more than once but submitting it once.
- **No internal ids leave in the confirmation.** The submitter gets back a
  `request_ref` and a status, never the row's UUID.
- **Every structural field is re-validated** server-side in
  `vacancy_request_intake.py` against master data, including the
  department/designation category rule. Nothing about the payload is trusted.
- **Submissions enter the normal approval workflow** via
  `vacancy_workflow.submit()`, so they are subject to the same Sanctioned
  Strength ceiling and produce the same audit trail and Dean notification as
  an in-app request. A QR request is not a side door into the queue.

The options endpoint returns id + label pairs for ACTIVE master data only.
That is genuinely public information (campus and department names are on the
institution's website), and the form cannot be filled in without it.
"""

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.rate_limit import RateLimiter
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.location import Location
from app.schemas.vacancy_request import (
    PublicVacancyRequestConfirmation,
    PublicVacancyRequestCreate,
    PublicVacancyRequestFormOptions,
)
from app.services import vacancy_request_intake

router = APIRouter(prefix="/public/vacancy-requests", tags=["public"])

# Submitting is the expensive, state-changing action -- kept tight. Reading
# the form's options is harmless and happens several times while someone
# picks a campus then a department, so it gets more headroom. Both are per-IP
# via the same in-memory limiter auth.py uses.
_submit_rate_limit = RateLimiter(max_requests=5, window_seconds=300, name="public-vacancy-request-submit")
_options_rate_limit = RateLimiter(max_requests=60, window_seconds=60, name="public-vacancy-request-options")


@router.get(
    "/form-options",
    response_model=PublicVacancyRequestFormOptions,
    dependencies=[Depends(_options_rate_limit)],
)
def get_public_form_options(
    campus_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
) -> PublicVacancyRequestFormOptions:
    """Id + label pairs for the public form's pickers.

    Departments and locations narrow to `campus_id` once one is chosen, which
    keeps the payload small and mirrors the cascading the authenticated forms
    already do. Only ACTIVE records are offered -- a public form must not let
    someone file against a retired department.

    Each list carries the minimum a picker needs and nothing else: no counts,
    no contact details, no audit fields.
    """
    campuses = [
        {"id": str(c.id), "code": c.code, "name": c.name}
        for c in db.query(Campus).filter(Campus.is_active.is_(True)).order_by(Campus.code).all()
    ]

    department_query = db.query(Department).filter(Department.is_active.is_(True))
    location_query = db.query(Location).filter(Location.is_active.is_(True))
    if campus_id is not None:
        department_query = department_query.filter(Department.campus_id == campus_id)
        location_query = location_query.filter(Location.campus_id == campus_id)

    departments = [
        {"id": str(d.id), "name": d.name, "campus_id": str(d.campus_id)}
        for d in department_query.order_by(Department.name).all()
    ]
    designations = [
        {"id": str(d.id), "name": d.name, "category": d.category.value}
        for d in db.query(Designation).filter(Designation.is_active.is_(True)).order_by(Designation.name).all()
    ]
    # block_building/floor_venue are sent through so the client can render the
    # same "Block - Floor" label the authenticated screens use; `name` alone
    # repeats across floors and is not distinguishable.
    locations = [
        {
            "id": str(loc.id),
            "name": loc.name,
            "block_building": loc.block_building,
            "floor_venue": loc.floor_venue,
            "campus_id": str(loc.campus_id),
        }
        for loc in location_query.order_by(Location.name).all()
    ]

    return PublicVacancyRequestFormOptions(
        campuses=campuses, departments=departments, designations=designations, locations=locations
    )


@router.post(
    "",
    response_model=PublicVacancyRequestConfirmation,
    status_code=201,
    dependencies=[Depends(_submit_rate_limit)],
)
def submit_public_vacancy_request(
    payload: PublicVacancyRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> PublicVacancyRequestConfirmation:
    """Create and submit one vacancy request from the public QR form.

    Returns only the request reference and status -- see
    `PublicVacancyRequestConfirmation` for why nothing else is exposed.
    """
    vr = vacancy_request_intake.create_public_vacancy_request(
        db,
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        designation_id=payload.designation_id,
        location_id=payload.location_id,
        requested_count=payload.number_of_positions,
        priority=payload.priority,
        required_by=payload.required_by,
        justification=payload.justification,
        requester_name=payload.requester_name.strip(),
        requester_email=str(payload.requester_email).strip(),
        requester_mobile=payload.requester_mobile.strip(),
        request=request,
    )
    return PublicVacancyRequestConfirmation(
        request_ref=vr.request_ref, status=vr.status, submitted_at=vr.submitted_at
    )
