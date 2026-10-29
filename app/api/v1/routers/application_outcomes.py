"""Rejected & Waiting List (pipeline-completion brief, Phase 1).

Read-only views over `Application`: the waiting list, ranked per vacancy,
and the rejections with their reason and stage, each with an Excel export.
Nothing here changes a status -- waitlisting, rejecting and promoting all go
through PATCH /applications/{id}/status, so pipeline.py stays the only
writer. Gated exactly like GET /applications (any staff member, campus
scope applied), since these are filtered slices of that same list.
"""

import io
import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Query as OrmQuery
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_current_active_user, get_db
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.department import Department
from app.models.enums import (
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    RejectionCategoryEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.schemas.application_outcome import ApplicationOutcomePage, ApplicationOutcomeRow
from app.services import exports

router = APIRouter(prefix="/application-outcomes", tags=["application-outcomes"])



def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_COLUMNS = (
    Application,
    Candidate,
    JobPosting.posting_number,
    VacancyRequest.position_title,
    Department.name,
    Campus.code,
    ApprovedVacancy.id,
    ApprovedVacancy.total_positions,
)


def _base_query(
    db: Session,
    scope: CampusScope,
    status_value: ApplicationStatusEnum,
    campus_code: str | None,
) -> OrmQuery:
    """Every filter but the category tab, which `_in_category` applies after
    `_page` has counted each tab -- so a tab's count does not change when a
    different tab is picked."""
    query = (
        db.query(*_COLUMNS)
        .join(Candidate, Application.candidate_id == Candidate.id)
        .join(JobPosting, Application.job_posting_id == JobPosting.id)
        .join(ApprovedVacancy, JobPosting.approved_vacancy_id == ApprovedVacancy.id)
        .join(VacancyRequest, ApprovedVacancy.vacancy_request_id == VacancyRequest.id)
        .outerjoin(Department, VacancyRequest.department_id == Department.id)
        .join(Campus, Application.campus_id == Campus.id)
        .filter(Application.status == status_value)
    )
    if not scope.is_global:
        query = query.filter(Application.campus_id == scope.campus_id)
    if campus_code:
        query = query.filter(Campus.code == campus_code.strip().upper())
    return query


def _slot_summary(db: Session, vacancy_ids: set) -> tuple[dict, dict]:
    """Open-slot counts and taken-slot holder names per approved vacancy, in
    two queries for the whole page rather than two per row."""
    if not vacancy_ids:
        return {}, {}
    open_counts = dict(
        db.query(HiringSlot.approved_vacancy_id, func.count(HiringSlot.id))
        .filter(HiringSlot.approved_vacancy_id.in_(vacancy_ids), HiringSlot.status == HiringSlotStatusEnum.OPEN)
        .group_by(HiringSlot.approved_vacancy_id)
        .all()
    )
    holders: dict = {}
    for vacancy_id, name in (
        db.query(HiringSlot.approved_vacancy_id, Candidate.full_name)
        .join(Application, HiringSlot.reserved_application_id == Application.id)
        .join(Candidate, Application.candidate_id == Candidate.id)
        .filter(
            HiringSlot.approved_vacancy_id.in_(vacancy_ids),
            HiringSlot.status.in_((HiringSlotStatusEnum.RESERVED, HiringSlotStatusEnum.FILLED)),
        )
        .order_by(HiringSlot.slot_number)
        .all()
    ):
        holders.setdefault(vacancy_id, []).append(name)
    return open_counts, holders


def _rows(db: Session, results) -> list[ApplicationOutcomeRow]:
    open_counts, holders = _slot_summary(db, {r[6] for r in results})
    return [_row(r, open_counts, holders) for r in results]


def _row(result, open_counts: dict, holders: dict) -> ApplicationOutcomeRow:
    (
        application,
        candidate,
        posting_number,
        position_title,
        department_name,
        campus_code,
        vacancy_id,
        total_positions,
    ) = result
    return ApplicationOutcomeRow(
        application_id=application.id,
        candidate_id=candidate.id,
        candidate_name=candidate.full_name,
        candidate_email=candidate.email,
        candidate_phone=candidate.phone_number,
        job_posting_id=application.job_posting_id,
        posting_number=posting_number,
        position_title=position_title,
        department_name=department_name,
        campus_code=campus_code,
        role_category=application.role_category,
        status=application.status,
        waitlist_rank=application.waitlist_rank,
        rejection_category=application.rejection_category,
        rejected_at_stage=application.rejected_at_stage,
        rejection_remarks=application.rejection_reason,
        rejected_at=application.rejected_at,
        updated_at=application.updated_at,
        interview_date=application.interview_scheduled_date,
        panel_remarks=application.panel_remarks,
        vacancy_total_positions=total_positions,
        vacancy_open_slots=open_counts.get(vacancy_id, 0),
        vacancy_slot_holders=holders.get(vacancy_id, []),
    )


def _in_category(query: OrmQuery, role_category: StaffRoleCategoryEnum | None) -> OrmQuery:
    if role_category is None:
        return query
    return query.filter(Application.role_category == role_category)


def _waiting_list_query(db, scope, campus_code, job_posting_id) -> OrmQuery:
    query = _base_query(db, scope, ApplicationStatusEnum.WAITLISTED, campus_code)
    if job_posting_id is not None:
        query = query.filter(Application.job_posting_id == job_posting_id)
    return query


# Grouped by vacancy, then rank; id last so paging is a total order.
_WAITING_LIST_ORDER = (
    VacancyRequest.position_title,
    JobPosting.posting_number,
    Application.waitlist_rank.asc().nulls_last(),
    Application.id,
)
_REJECTED_ORDER = (Application.rejected_at.desc().nulls_last(), Application.id)


def _rejected_query(db, scope, campus_code, rejection_category, rejected_at_stage, date_from, date_to) -> OrmQuery:
    query = _base_query(db, scope, ApplicationStatusEnum.REJECTED, campus_code)
    if rejection_category is not None:
        query = query.filter(Application.rejection_category == rejection_category)
    if rejected_at_stage is not None:
        query = query.filter(Application.rejected_at_stage == rejected_at_stage)
    if date_from is not None:
        query = query.filter(Application.rejected_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to is not None:
        query = query.filter(
            Application.rejected_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc)
        )
    return query


def _page(
    query: OrmQuery, role_category: StaffRoleCategoryEnum | None, order, limit: int, offset: int
) -> ApplicationOutcomePage:
    by_category = dict(
        query.with_entities(Application.role_category, func.count(Application.id))
        .group_by(Application.role_category)
        .all()
    )
    category_counts = {c.value: by_category.get(c, 0) for c in StaffRoleCategoryEnum}
    category_counts["ALL"] = sum(by_category.values())
    query = _in_category(query, role_category)
    total = query.count()
    rows = _rows(query.session, query.order_by(*order).offset(offset).limit(limit).all())
    return ApplicationOutcomePage(
        items=rows, total=total, limit=limit, offset=offset, category_counts=category_counts
    )


def _xlsx(sheet_title: str, headers: list[str], values: list[list], filename_stem: str) -> StreamingResponse:
    now = datetime.now(timezone.utc)
    excel_bytes = exports.build_application_outcome_export_excel(
        sheet_title=sheet_title,
        headers=headers,
        row_values=values,
        generated_at=now,
        scope_note=f"{len(values)} application(s) matching the applied filters.",
    )
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="simats-{filename_stem}-{now:%Y%m%d}.xlsx"'},
    )


def _common(r: ApplicationOutcomeRow) -> list:
    return [
        r.candidate_name,
        r.candidate_email,
        r.candidate_phone,
        r.position_title,
        r.department_name,
        r.posting_number,
        r.campus_code,
        r.role_category.value,
    ]


_COMMON_HEADERS = ["Candidate", "Email", "Phone", "Position", "Department", "Posting No.", "Campus", "Category"]


@router.get("/waiting-list", response_model=ApplicationOutcomePage)
def list_waiting_list(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    role_category: StaffRoleCategoryEnum | None = Query(None),
    campus_code: str | None = Query(None),
    job_posting_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ApplicationOutcomePage:
    query = _waiting_list_query(db, scope, campus_code, job_posting_id)
    return _page(query, role_category, _WAITING_LIST_ORDER, limit, offset)


@router.get("/waiting-list/export")
def export_waiting_list(
    role_category: StaffRoleCategoryEnum | None = Query(None),
    campus_code: str | None = Query(None),
    job_posting_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    query = _in_category(_waiting_list_query(db, scope, campus_code, job_posting_id), role_category)
    rows = _rows(db, query.order_by(*_WAITING_LIST_ORDER).all())
    return _xlsx(
        "Waiting List",
        [*_COMMON_HEADERS, "Rank"],
        [[*_common(r), r.waitlist_rank] for r in rows],
        "waiting-list",
    )


@router.get("/rejected", response_model=ApplicationOutcomePage)
def list_rejected(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    role_category: StaffRoleCategoryEnum | None = Query(None),
    campus_code: str | None = Query(None),
    rejection_category: RejectionCategoryEnum | None = Query(None),
    rejected_at_stage: ApplicationStatusEnum | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ApplicationOutcomePage:
    query = _rejected_query(db, scope, campus_code, rejection_category, rejected_at_stage, date_from, date_to)
    return _page(query, role_category, _REJECTED_ORDER, limit, offset)


@router.get("/rejected/export")
def export_rejected(
    role_category: StaffRoleCategoryEnum | None = Query(None),
    campus_code: str | None = Query(None),
    rejection_category: RejectionCategoryEnum | None = Query(None),
    rejected_at_stage: ApplicationStatusEnum | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    query = _rejected_query(db, scope, campus_code, rejection_category, rejected_at_stage, date_from, date_to)
    rows = _rows(db, _in_category(query, role_category).order_by(*_REJECTED_ORDER).all())
    return _xlsx(
        "Rejected",
        [*_COMMON_HEADERS, "Reason", "Stage when rejected", "Remarks", "Rejected on"],
        [
            [
                *_common(r),
                r.rejection_category.value if r.rejection_category else None,
                r.rejected_at_stage.value if r.rejected_at_stage else None,
                r.rejection_remarks,
                r.rejected_at,
            ]
            for r in rows
        ],
        "rejected",
    )
