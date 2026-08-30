import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import (
    EmploymentTypeEnum,
    StaffRoleCategoryEnum,
    VacancyPriorityEnum,
    VacancyRequestSourceEnum,
    VacancyRequestStatusEnum,
)


class VacancyRequestCreate(BaseModel):
    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID | None = None
    role_category: StaffRoleCategoryEnum
    # Still required even when designation_id is set -- the caller may pass
    # any placeholder value here since the service layer overwrites it from
    # Designation.name when a designation_id is provided (kept required,
    # not optional, so every other existing consumer of position_title needs
    # no changes).
    position_title: str
    employment_type: EmploymentTypeEnum
    requested_count: int = Field(gt=0)
    qualification: str
    experience_required: str
    salary_band_min: float | None = None
    salary_band_max: float | None = None
    jd_draft: str | None = None
    remarks: str | None = None
    skills: list[str] | None = None
    priority: VacancyPriorityEnum = VacancyPriorityEnum.NORMAL
    # Intake fields (2026-08-30). Both optional so every existing caller is
    # unaffected -- Pydantic silently DROPS unknown keys, so a field added
    # here that an old client does not send is simply absent, not an error.
    location_id: uuid.UUID | None = None
    required_by: date | None = None


class VacancyRequestUpdate(BaseModel):
    position_title: str | None = None
    employment_type: EmploymentTypeEnum | None = None
    requested_count: int | None = Field(default=None, gt=0)
    qualification: str | None = None
    experience_required: str | None = None
    salary_band_min: float | None = None
    salary_band_max: float | None = None
    jd_draft: str | None = None
    remarks: str | None = None
    skills: list[str] | None = None
    priority: VacancyPriorityEnum | None = None
    location_id: uuid.UUID | None = None
    required_by: date | None = None


class VacancyRequestSubmitRequest(BaseModel):
    """Optional body for POST /{id}/submit -- omit entirely for the ordinary
    submit path. `override_sanction`/`override_justification` are the
    SUPER_ADMIN-only escape hatch for the Sanctioned Strength <->
    VacancyRequest link (zany-snuggling-pie.md Phase E); see
    app/services/vacancy_workflow.py::submit() for the 403/400 gating."""

    override_sanction: bool = False
    override_justification: str | None = None


class VacancyRequestRejectRequest(BaseModel):
    reason: str = Field(min_length=1)


class VacancyRequestCancelRequest(BaseModel):
    reason: str = Field(min_length=1)


class VacancySlotCountUpdateRequest(BaseModel):
    requested_count: int = Field(gt=0)


class VacancyRequestGenerateJDRequest(BaseModel):
    additional_instructions: str | None = None


class VacancyRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID | None
    role_category: StaffRoleCategoryEnum
    position_title: str
    employment_type: EmploymentTypeEnum
    requested_count: int
    qualification: str
    experience_required: str
    salary_band_min: float | None
    salary_band_max: float | None
    jd_draft: str | None
    remarks: str | None
    skills: list[str] | None
    priority: VacancyPriorityEnum
    status: VacancyRequestStatusEnum
    # Intake fields (2026-08-30). `source` powers the Source filter on the
    # Vacancy Requests screen; `requester_*` are populated ONLY for QR rows,
    # where there is no internal user behind the request -- for those,
    # `requested_by_id` is the account that owns the intake, not the person
    # who asked, so a UI showing "raised by" should prefer requester_name
    # when it is set.
    source: VacancyRequestSourceEnum
    request_ref: str | None
    location_id: uuid.UUID | None
    required_by: date | None
    requester_name: str | None
    requester_email: str | None
    requester_mobile: str | None
    requested_by_id: uuid.UUID
    submitted_at: datetime | None
    dean_reviewed_by_id: uuid.UUID | None
    dean_reviewed_at: datetime | None
    hr_reviewed_by_id: uuid.UUID | None
    hr_reviewed_at: datetime | None
    rejected_by_id: uuid.UUID | None
    rejected_at: datetime | None
    rejection_reason: str | None
    cancelled_by_id: uuid.UUID | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    # Sanctioned Strength enforcement (zany-snuggling-pie.md Phase E) -- see
    # app/models/vacancy_request.py for the fields, app/services/
    # vacancy_workflow.py::submit() for what sets them.
    is_over_sanction: bool
    over_sanction_justification: str | None
    created_at: datetime
    updated_at: datetime


# --- Public (QR) intake, 2026-08-30 ---------------------------------------


class PublicVacancyRequestCreate(BaseModel):
    """Body of the public, unauthenticated vacancy-request form.

    Deliberately a SEPARATE schema from `VacancyRequestCreate` rather than a
    reuse of it. That one accepts `position_title`, `qualification`,
    `salary_band_min/max`, `jd_draft` and `skills` -- fields an anonymous
    caller has no business setting, and which would let a public form write
    salary bands into a record that goes on to become a published job ad.
    Everything structural here is an id re-validated server-side; everything
    descriptive is derived from Designation Master.

    `designation_id` is REQUIRED here although the authenticated schema makes
    it optional: without one there is no Sanctioned Strength ceiling to check
    (see vacancy_workflow.submit), so a public submission could bypass the
    limit entirely by simply omitting it.
    """

    campus_id: uuid.UUID
    department_id: uuid.UUID
    designation_id: uuid.UUID
    location_id: uuid.UUID | None = None
    # Bounded rather than merely positive: an unbounded integer from a public
    # form is a denial-of-service on the approval queue, not a vacancy.
    number_of_positions: int = Field(ge=1, le=100)
    priority: VacancyPriorityEnum = VacancyPriorityEnum.NORMAL
    required_by: date | None = None
    # min_length forces a real reason rather than a single character; the
    # cap keeps a public text field from becoming unbounded storage.
    justification: str = Field(min_length=10, max_length=2000)
    requester_name: str = Field(min_length=2, max_length=150)
    requester_email: EmailStr
    # Kept as a permissive pattern rather than a strict national format --
    # SIMATS staff enter numbers with and without country codes and spacing,
    # and rejecting a valid number is worse here than storing an odd one.
    requester_mobile: str = Field(min_length=6, max_length=20, pattern=r"^[0-9+\-\s()]+$")


class PublicVacancyRequestConfirmation(BaseModel):
    """What a public submitter is told back.

    Only these three fields, on purpose: the row's UUID, its campus/department
    ids and every other internal identifier stay unexposed. `request_ref` is
    the one thing a requester can quote when chasing the request.
    """

    request_ref: str
    status: VacancyRequestStatusEnum
    submitted_at: datetime | None


class PublicVacancyRequestFormOptions(BaseModel):
    """Master data the public form needs to render its pickers.

    Served unauthenticated, so it is deliberately minimal: id + label only,
    active records only, and no counts, contact details or audit fields. It is
    the smallest set that lets someone fill the form in.
    """

    campuses: list[dict]
    departments: list[dict]
    designations: list[dict]
    locations: list[dict]


class VacancyRequestQrCodeInfo(BaseModel):
    """Where the QR code points, for the staff-facing QR management panel."""

    url: str
