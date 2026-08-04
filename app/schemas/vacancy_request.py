import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, VacancyPriorityEnum, VacancyRequestStatusEnum


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
    created_at: datetime
    updated_at: datetime
