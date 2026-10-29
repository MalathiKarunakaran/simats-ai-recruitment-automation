import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.models.enums import ApplicationStatusEnum, RejectionCategoryEnum, StaffRoleCategoryEnum
from app.schemas.common import PaginatedResponse


class ApplicationOutcomeRow(BaseModel):
    """One row of the Rejected & Waiting List page, flattened for a table
    and for the Excel export (both tabs share the shape; the fields the
    other tab owns are simply None)."""

    application_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    candidate_phone: str | None
    job_posting_id: uuid.UUID
    posting_number: str | None
    position_title: str
    department_name: str | None
    campus_code: str
    role_category: StaffRoleCategoryEnum
    status: ApplicationStatusEnum
    waitlist_rank: int | None
    rejection_category: RejectionCategoryEnum | None
    rejected_at_stage: ApplicationStatusEnum | None
    rejection_remarks: str | None
    rejected_at: datetime | None
    updated_at: datetime
    # For the page's vacancy groups (2026-10-29): what the interview panel
    # recorded, and whether the vacancy has a free post for a promotion.
    interview_date: date | None
    panel_remarks: str | None
    vacancy_total_positions: int
    vacancy_open_slots: int
    # Candidates holding this vacancy's taken posts (RESERVED or FILLED
    # slots), so the page can say who a promotion is waiting on.
    vacancy_slot_holders: list[str]


class ApplicationOutcomePage(PaginatedResponse[ApplicationOutcomeRow]):
    """`category_counts` is `{"TEACHING", "NON_TEACHING", "HOUSEKEEPING",
    "ALL"}` across every filter except the category itself -- the same
    shape as DepartmentListResponse, for the CategoryTabs counts."""

    category_counts: dict[str, int]
