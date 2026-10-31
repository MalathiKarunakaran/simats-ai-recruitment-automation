"""Selection batches (docs/specs/selection-batches.md, pipeline brief Phase 3).

The list of Talent Pool people whose sheet status is Selected, sent to the
University. All writes go through `services/selection_batches.py`; this
router validates, calls it and commits (get_db never does).

Gated with `require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR)`
(decision D5) rather than a new `PermissionEnum`. Batches have no campus
scoping for the same reason the Talent Pool has none: a pool person has no
campus, and all three roles are in `GLOBAL_SCOPE_ROLES` (a test asserts it).
"""

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_roles
from app.models.enums import UserRoleEnum
from app.models.selection_batch import SelectionBatch, SelectionBatchMember
from app.schemas.common import PaginatedResponse
from app.schemas.selection_batch import (
    MAX_BATCH_MEMBERS,
    SelectionBatchCreate,
    SelectionBatchDetail,
    SelectionBatchOut,
    SelectionBatchWithdraw,
    UniversityApproval,
)
from app.services import selection_batches as service
from app.services.selection_batch_pdf import render_batch_pdf
from app.services.xlsx_safety import harden_workbook

router = APIRouter(prefix="/selection-batches", tags=["selection-batches"])

_ALLOWED = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _out(batch: SelectionBatch, member_count: int) -> dict:
    return {
        "id": batch.id,
        "batch_no": batch.batch_no,
        "status": batch.status,
        "campus_id": batch.campus_id,
        "campus_code": batch.campus.code if batch.campus else None,
        "note": batch.note,
        "sent_on": batch.sent_on,
        "university_ref_no": batch.university_ref_no,
        "university_approved_on": batch.university_approved_on,
        "created_by_id": batch.created_by_id,
        "approval_recorded_by_id": batch.approval_recorded_by_id,
        "member_count": member_count,
        "created_at": batch.created_at,
    }


def _detail(batch: SelectionBatch) -> SelectionBatchDetail:
    return SelectionBatchDetail(**_out(batch, len(batch.members)), members=batch.members)


def _get(db: Session, batch_id: uuid.UUID) -> SelectionBatch:
    batch = db.get(SelectionBatch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Selection batch not found")
    return batch


@router.post("", response_model=SelectionBatchDetail, status_code=status.HTTP_201_CREATED)
def create_batch(
    payload: SelectionBatchCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*_ALLOWED)),
) -> SelectionBatchDetail:
    batch = service.create_batch(db, actor=current_user, payload=payload)
    db.commit()
    db.refresh(batch)
    return _detail(batch)


@router.get("", response_model=PaginatedResponse[SelectionBatchOut])
def list_batches(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(require_roles(*_ALLOWED)),
) -> PaginatedResponse[SelectionBatchOut]:
    where = [SelectionBatch.status == status_filter] if status_filter else []
    total = db.execute(select(func.count()).select_from(SelectionBatch).where(*where)).scalar_one()
    counts = (
        select(SelectionBatchMember.batch_id, func.count().label("n"))
        .group_by(SelectionBatchMember.batch_id)
        .subquery()
    )
    rows = db.execute(
        select(SelectionBatch, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.batch_id == SelectionBatch.id)
        .where(*where)
        .order_by(SelectionBatch.created_at.desc(), SelectionBatch.batch_no.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return PaginatedResponse(
        items=[SelectionBatchOut(**_out(b, n)) for b, n in rows], total=total, limit=limit, offset=offset
    )


# Declared before /{batch_id} so "membership" is not parsed as an id.
@router.get("/membership", response_model=dict[str, str])
def entry_membership(
    entry_ids: list[uuid.UUID] = Query(..., max_length=MAX_BATCH_MEMBERS),
    db: Session = Depends(get_db),
    _user=Depends(require_roles(*_ALLOWED)),
) -> dict[str, str]:
    """{entry_id: batch_no} for the given talent pool entries that already sit
    in a batch that is not withdrawn. Entries not in a batch are absent."""
    return service.membership(db, entry_ids)


@router.get("/{batch_id}", response_model=SelectionBatchDetail)
def get_batch(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_roles(*_ALLOWED)),
) -> SelectionBatchDetail:
    return _detail(_get(db, batch_id))


@router.post("/{batch_id}/approval", response_model=SelectionBatchDetail)
def record_approval(
    batch_id: uuid.UUID,
    payload: UniversityApproval,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*_ALLOWED)),
) -> SelectionBatchDetail:
    batch = service.record_university_approval(
        db, actor=current_user, batch=_get(db, batch_id),
        ref_no=payload.university_ref_no, approved_on=payload.university_approved_on,
    )
    db.commit()
    db.refresh(batch)
    return _detail(batch)


@router.post("/{batch_id}/withdraw", response_model=SelectionBatchDetail)
def withdraw_batch(
    batch_id: uuid.UUID,
    payload: SelectionBatchWithdraw | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(*_ALLOWED)),
) -> SelectionBatchDetail:
    batch = service.withdraw(
        db, actor=current_user, batch=_get(db, batch_id), reason=payload.reason if payload else None
    )
    db.commit()
    db.refresh(batch)
    return _detail(batch)


@router.get("/{batch_id}/export.xlsx")
def export_xlsx(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_roles(*_ALLOWED)),
) -> StreamingResponse:
    batch = _get(db, batch_id)
    campus = batch.campus.code if batch.campus else ""
    wb = Workbook()
    ws = wb.active
    ws.title = "Selection list"
    ws.append([f"Selection list {batch.batch_no}"])
    ws.append([f"Date: {batch.sent_on:%d-%m-%Y}", f"Campus: {campus}"])
    ws.append(["S.No", "Name", "Designation", "Department", "Category", "Campus", "Qualification",
               "Experience", "Panel remarks", "Proposed salary"])  # fmt: skip
    for number, m in enumerate(batch.members, start=1):
        ws.append([number, m.full_name, m.designation, m.department, m.category, campus, m.qualification,
                   m.experience, m.panel_remarks, m.proposed_salary])  # fmt: skip
    harden_workbook(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="simats-{batch.batch_no}.xlsx"'},
    )


@router.get("/{batch_id}/export.pdf")
def export_pdf(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user=Depends(require_roles(*_ALLOWED)),
) -> Response:
    batch = _get(db, batch_id)
    return Response(
        render_batch_pdf(batch),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="simats-{batch.batch_no}.pdf"'},
    )
