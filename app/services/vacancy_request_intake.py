"""Public (QR) vacancy-request intake -- 2026-08-30.

This is the only place in the codebase that creates a `VacancyRequest` for a
caller who is not signed in, so the rules it follows are worth stating up
front.

**It does not bypass the workflow.** `app/services/vacancy_workflow.py` is the
single choke point for `VacancyRequest.status` (see CLAUDE.md). A public
submission is therefore created as DRAFT and immediately put through
`vacancy_workflow.submit()`, exactly as the in-app flow does. That is what
makes a QR request inherit the Sanctioned Strength ceiling check, the audit
entry and the Dean notification for free, instead of appearing in the
approval queue having skipped all three. The brief's "status = PENDING" maps
to SUBMITTED, this system's name for "raised, awaiting Dean review" -- there
is no PENDING member of `VacancyRequestStatusEnum`.

**It never trusts the payload for anything structural.** Campus, department,
designation and location are all re-validated against master data server-side,
including the department/designation category compatibility rule
(`Department.supports`) that the authenticated create path enforces. The
public form is the least trustworthy caller in the system.

**It does not expose internal ids.** The confirmation returns `request_ref`
("VR-2026-000123"), never the row's UUID, so a submitter has something to
quote without being handed a key to anything.
"""

import io
import uuid
from datetime import date, datetime, timezone

import qrcode
from fastapi import HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import (
    UserRoleEnum,
    VacancyPriorityEnum,
    VacancyRequestSourceEnum,
)
from app.models.location import Location
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.core.config import settings
from app.services import vacancy_request_rules, vacancy_workflow

# "VR-2026-000123". The year makes the reference self-dating and restarts the
# sequence annually, which keeps it short enough to read aloud over a phone.
_REF_PREFIX = "VR"
_REF_SEQUENCE_WIDTH = 6
# A unique constraint backs request_ref, so a concurrent submission losing the
# race raises IntegrityError rather than duplicating. Retrying a handful of
# times is enough for a form humans fill in; unbounded retries would turn a
# genuine constraint problem into a hang.
_REF_MAX_ATTEMPTS = 5


def _next_request_ref(db: Session, *, today: date | None = None) -> str:
    """Next free reference for the current year.

    Derived by counting this year's existing refs rather than from a database
    sequence: a sequence would need its own migration and would drift from the
    year-prefixed format the moment the year rolled over. The uniqueness
    guarantee lives on the column, not here -- this only has to produce a
    good first guess.
    """
    year = (today or datetime.now(timezone.utc).date()).year
    prefix = f"{_REF_PREFIX}-{year}-"
    used = (
        db.query(func.count(VacancyRequest.id)).filter(VacancyRequest.request_ref.like(f"{prefix}%")).scalar() or 0
    )
    return f"{prefix}{used + 1:0{_REF_SEQUENCE_WIDTH}d}"


def resolve_intake_user(db: Session) -> User:
    """The account a QR submission is attributed to.

    `VacancyRequest.requested_by_id` is NOT NULL and five notification sites
    in `vacancy_workflow.py` dereference `.requested_by`, so every row needs a
    real user behind it. Making the column nullable would have rippled through
    all five; attributing the row to an owning account does not, and the
    person who actually asked is recorded in `requester_name`/`_email`/
    `_mobile` on the row itself.

    Prefers the explicitly configured `QR_INTAKE_USER_EMAIL`. Falls back to the
    longest-standing active SUPER_ADMIN so the feature works in a deployment
    that has not configured one -- deterministic (ordered by `created_at`), not
    "whichever row the database happens to return first".

    Raises 503, not 500, when neither resolves: the endpoint is correctly
    implemented but this deployment is not configured to accept public
    submissions yet, which is the same distinction `ai_client.py` draws for a
    missing API key.
    """
    configured_email = settings.QR_INTAKE_USER_EMAIL.strip()
    if configured_email:
        user = (
            db.query(User)
            .filter(func.lower(User.email) == configured_email.lower(), User.is_active.is_(True))
            .first()
        )
        if user is not None:
            return user
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public vacancy-request intake is misconfigured (QR_INTAKE_USER_EMAIL does not match an active user).",
        )

    fallback = (
        db.query(User)
        .filter(User.role == UserRoleEnum.SUPER_ADMIN, User.is_active.is_(True))
        .order_by(User.created_at.asc())
        .first()
    )
    if fallback is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public vacancy-request intake is not configured on this deployment.",
        )
    return fallback


def build_public_request_url() -> str:
    """The URL a generated QR code points at.

    Uses the configured frontend base (see `Settings.public_app_base_url`) --
    never a hard-coded host. Deliberately NOT `PUBLIC_APPLY_BASE_URL`, which
    is the candidate careers site: pointing staff there would send them to a
    different application.
    """
    return f"{settings.public_app_base_url}/vacancy-request/public"


def generate_public_request_qr_png() -> bytes:
    """PNG of the QR code pointing at the public form.

    Generated on demand and never persisted -- the same choice
    `job_distribution.generate_qr_code_png` makes for job-ad QR codes, and for
    the same reason: the target is derived from configuration, so a stored
    image would silently go stale the moment the deployment's base URL
    changed. There is exactly ONE global QR code for vacancy-request intake,
    per the brief, so nothing here is per-campus or per-user.
    """
    image = qrcode.make(build_public_request_url())
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _validated_master_data(
    db: Session,
    *,
    campus_id: uuid.UUID,
    department_id: uuid.UUID,
    designation_id: uuid.UUID,
    location_id: uuid.UUID | None,
) -> tuple[Campus, Department, Designation, Location | None]:
    """Every structural field re-checked against master data.

    Error messages name the field but never echo an internal id back, and a
    mismatch is a 400 rather than a 404 -- a public caller should not be able
    to probe which ids exist by watching status codes.
    """
    campus = db.get(Campus, campus_id)
    if campus is None or not campus.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive campus.")

    department = db.get(Department, department_id)
    if department is None or department.campus_id != campus_id or not department.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Department does not belong to the selected campus."
        )

    designation = db.get(Designation, designation_id)
    if designation is None or not designation.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive designation.")

    # The same category rule the authenticated path enforces. A department is
    # a place, not a staff category, so this is a MEMBERSHIP test -- see
    # CLAUDE.md on why `designation.category == department.category` was the
    # original bug.
    if not department.supports(designation.category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{department.name} does not support {designation.category.value} designations.",
        )

    # Ownership AND the required-when-available rule, shared verbatim with the
    # authenticated create so the two intake surfaces cannot drift apart.
    vacancy_request_rules.validate_location(db, campus_id=campus_id, location_id=location_id)
    location = db.get(Location, location_id) if location_id is not None else None

    return campus, department, designation, location


def create_public_vacancy_request(
    db: Session,
    *,
    campus_id: uuid.UUID,
    department_id: uuid.UUID,
    designation_id: uuid.UUID,
    location_id: uuid.UUID | None,
    requested_count: int,
    priority: VacancyPriorityEnum,
    required_by: date | None,
    justification: str,
    requester_name: str,
    requester_email: str,
    requester_mobile: str,
    request: Request | None,
) -> VacancyRequest:
    """Validate, create as DRAFT, then submit through the normal choke point.

    Returns the submitted request. The caller is responsible for exposing only
    `request_ref` and `status` to the public -- see
    `app/schemas/vacancy_request.py::PublicVacancyRequestConfirmation`.
    """
    campus, department, designation, _location = _validated_master_data(
        db,
        campus_id=campus_id,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
    )
    intake_user = resolve_intake_user(db)

    # qualification / experience_required / employment_type are NOT NULL on
    # VacancyRequest but are not asked for on the public form -- the requester
    # is describing a need, not writing a job spec. All three are taken from
    # Designation Master, which holds them as NOT NULL columns, so the record
    # is complete and consistent with what an in-app request for the same
    # designation would carry. Hard-coding FULL_TIME here would silently
    # contradict a designation defined as visiting or contract.

    vr = VacancyRequest(
        campus_id=campus_id,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        role_category=designation.category,
        position_title=designation.name,
        employment_type=designation.employment_type,
        requested_count=requested_count,
        qualification=designation.qualification,
        experience_required=designation.min_experience,
        remarks=justification,
        priority=priority,
        required_by=required_by,
        source=VacancyRequestSourceEnum.QR,
        requester_name=requester_name,
        requester_email=requester_email,
        requester_mobile=requester_mobile,
        requested_by_id=intake_user.id,
    )

    for attempt in range(_REF_MAX_ATTEMPTS):
        vr.request_ref = _next_request_ref(db)
        try:
            db.add(vr)
            db.flush()
            break
        except IntegrityError:
            # Another submission took this reference between our count and our
            # insert. Roll back to a clean session and recount rather than
            # incrementing blindly, which would collide again under sustained
            # concurrency.
            db.rollback()
            if attempt == _REF_MAX_ATTEMPTS - 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Could not allocate a request reference, please try again.",
                )
            db.add(vr)

    # Straight through the normal choke point: sanction ceiling, audit entry
    # and Dean notification all happen here rather than being re-implemented.
    #
    # An explicit rollback on failure, rather than relying on `get_db` closing
    # the session: a refused submission (most often the Sanctioned Strength
    # ceiling, a 409) must leave NOTHING behind, and for a public endpoint
    # that guarantee should be stated in the code rather than inherited from
    # session-teardown semantics. Without it the DRAFT row created above stays
    # pending in the session, which is invisible in production but is exactly
    # the kind of detail that stops being true when a caller wraps this in a
    # longer-lived transaction.
    try:
        vacancy_workflow.submit(db, vr, actor=intake_user, request=request)
    except Exception:
        db.rollback()
        raise

    db.commit()
    db.refresh(vr)
    return vr
