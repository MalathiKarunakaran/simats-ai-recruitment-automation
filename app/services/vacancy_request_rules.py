"""Intake rules shared by BOTH vacancy-request creation surfaces -- 2026-09-02.

There are two ways a `VacancyRequest` is created by a human: the authenticated
wizard (`POST /vacancy-requests`) and the public QR form
(`POST /public/vacancy-requests`). They deliberately have different schemas --
an anonymous caller may not set salary bands or JD text -- but the rules about
*where a post sits* must not drift apart between them, which is what this
module exists to prevent.

(The third creation path, `vacancy_request_import.py`'s bulk upload, does not
call this: its template has no Location column at all, so every bulk row is
location-less by construction. That inconsistency is known and was left
alone deliberately -- adding a Location column to the template is a separate
decision.)
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.location import Location


def campus_has_locations(db: Session, campus_id: uuid.UUID) -> bool:
    """Whether this campus has any active Location to choose from."""
    return (
        db.query(Location.id)
        .filter(Location.campus_id == campus_id, Location.is_active.is_(True))
        .first()
        is not None
    )


def validate_location(db: Session, *, campus_id: uuid.UUID, location_id: uuid.UUID | None) -> None:
    """Enforce the location rule for a request being raised on `campus_id`.

    **Required, but only where the data exists.** A location is mandatory when
    the campus has at least one active Location, and optional when it has
    none. That conditional is not a hedge -- it is the only shape that is both
    correct and shippable against the real data: at the time of writing only 2
    of 7 campuses have any locations at all (SSE 18, SSPE 4; SCAD, SCLAS,
    SHIFT, SPIER and STUDIO have zero). A flat requirement would have made it
    impossible to raise a vacancy request on five campuses, which is a far
    worse failure than a missing location. The rule tightens on its own the
    moment a campus gets its first location, with no code change.

    **A Location is a physical place, never narrowed by staff category.** There
    is deliberately no `category` condition here and there must never be one --
    a room does not stop existing because the post is non-teaching. The
    identical filter on the Sanctioned Strength drawer left every NON_TEACHING
    and HOUSEKEEPING row with an empty dropdown in production (fixed in
    d28d72c). Teaching and Non-Teaching see exactly the same list.

    Raises 400 (never 404) on a mismatch, so a public caller cannot probe which
    location ids exist by watching status codes.
    """
    if location_id is not None:
        location = db.get(Location, location_id)
        if location is None or location.campus_id != campus_id or not location.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Location does not belong to the selected campus.",
            )
        return

    if campus_has_locations(db, campus_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location is required for this campus.",
        )
