"""Shapes served to and taken from the public careers pages (2026-09-07).

Served unauthenticated, so every read shape here is a deliberate subset of
`JobPostingRead`: no internal ids apart from the posting's public slug, no
slot detail, no editor identity, no request or requisition linkage. What a
candidate needs to decide whether to apply, and nothing that maps the inside
of the system.
"""

from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import JobPostingStatusEnum, StaffRoleCategoryEnum


class PublicJobPostingSummary(BaseModel):
    """One card on the careers list."""

    posting_number: str | None
    public_apply_slug: str
    title: str
    campus_code: str
    campus_name: str
    department_name: str
    role_category: StaffRoleCategoryEnum
    employment_type: str
    qualification: str
    experience_required: str
    positions_open: int
    apply_deadline: date | None
    published_at: datetime


class PublicJobPostingDetail(PublicJobPostingSummary):
    """The posting's own page. `status` and `is_accepting_applications` are
    exposed so a stale QR code lands on "this posting has closed" rather than
    a bare 404 -- the slug is already on a printed poster by then."""

    ad_body: str
    contact_email: str | None
    status: JobPostingStatusEnum
    is_accepting_applications: bool


class PublicJobPostingList(BaseModel):
    items: list[PublicJobPostingSummary]
    total: int


MAX_NAME_LENGTH = 150
MIN_NAME_LENGTH = 2
MAX_PHONE_LENGTH = 20


class PublicApplicationCreate(BaseModel):
    """The apply form's text fields. Arrives as multipart alongside the resume
    file, so the router assembles this from `Form()` values and lets pydantic
    do the validating -- one set of rules, in one place."""

    full_name: str = Field(min_length=MIN_NAME_LENGTH, max_length=MAX_NAME_LENGTH)
    email: EmailStr
    phone_number: str | None = Field(default=None, max_length=MAX_PHONE_LENGTH)


class PublicApplicationConfirmation(BaseModel):
    """What the applicant is told back. The application's id is deliberately
    not here -- there is nothing a candidate can do with it, and it is an
    internal key. The posting number is the thing to quote."""

    posting_number: str | None
    title: str
    applicant_name: str
    applied_at: datetime
