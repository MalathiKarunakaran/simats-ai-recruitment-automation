"""Department Master (extended 2026-08-25, backend Phase 1 of the
Departments-page production-hardening epic) with bulk upload (validate ->
preview -> commit), export, server-side search/sort/filter, and dynamic
category tab counts -- same shape as `designations.py`'s own
`category_counts` pattern and `locations.py`'s own `/bulk-upload/*` family
(see `app/services/department_import.py` for the validate/commit logic).
The 4 shared, entity-agnostic bulk-upload endpoints (list/error-report/
original-file/undo) live in `app/api/v1/routers/sanctioned_strength.py`,
dispatched via `BulkUploadLog.entity_type == DEPARTMENT` -- not duplicated
here, same reuse `locations.py`/`housekeeping_staff.py` already rely on.

DELETE below is unchanged from before this epic -- an existing, correct
soft-delete (`is_active=False`, never a real DELETE) already blocked with a
409 + clear count-based message while active Users or active Designations
still reference this department.
"""

import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CampusScope, get_campus_scope, get_current_active_user, get_db, require_permission
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import (
    BulkUploadEntityTypeEnum,
    BulkUploadStatusEnum,
    PermissionEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentListResponse, DepartmentRead, DepartmentUpdate
from app.schemas.department_import import (
    DepartmentBulkUploadCommitResponse,
    DepartmentBulkUploadRowPreview,
    DepartmentBulkUploadValidationResponse,
)
from app.services import department_import, exports, storage
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/departments", tags=["departments"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as every other bulk-upload endpoint in this app

_SORT_FIELDS = Literal["name", "code", "category", "campus", "parent_group", "is_active"]
_SORT_COLUMNS = {
    "name": Department.name,
    "code": Department.code,
    "category": Department.supported_categories,
    "parent_group": Department.parent_group,
    "is_active": Department.is_active,
}


def _department_snapshot(department: Department) -> dict:
    return {
        "campus_id": department.campus_id,
        "name": department.name,
        "code": department.code,
        "supported_categories": [category.value for category in department.supported_categories or []],
        "parent_group": department.parent_group,
        "description": department.description,
        "is_active": department.is_active,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _base_query(
    db: Session,
    scope: CampusScope,
    *,
    campus_id: uuid.UUID | None,
    search: str | None,
    is_active: bool | None,
    parent_group: str | None = None,
):
    """Every filter shared between `list_departments` and `export_departments`
    EXCEPT `category` itself -- `category` is applied by each caller
    separately, after `list_departments` computes `category_counts` off this
    same base query (mirrors `designations.py::list_designations`'s own
    category-tab-counts pattern exactly).

    `parent_group` is an exact-match filter (not `ilike`) against whatever
    real, already-entered values exist -- see `GET /departments/parent-groups`
    below for how the frontend sources its dropdown options from real DB
    values rather than a hardcoded or free-text-guessed list. `parent_group`
    stays free text on the model itself (deliberately not a lookup table,
    per Department's own existing design comment) -- this filter doesn't
    change that, it just lets a caller narrow to one already-existing value."""
    query = db.query(Department)
    if scope.is_global:
        # Non-global roles are always forced onto their own campus_id below;
        # a global-scope role may optionally narrow to one campus via this
        # query param -- same precedent as locations.py's own list endpoint.
        if campus_id is not None:
            query = query.filter(Department.campus_id == campus_id)
    else:
        query = query.filter(Department.campus_id == scope.campus_id)

    if search:
        like = f"%{search}%"
        query = query.filter(or_(Department.name.ilike(like), Department.code.ilike(like)))
    if is_active is not None:
        query = query.filter(Department.is_active == is_active)
    if parent_group is not None:
        query = query.filter(Department.parent_group == parent_group)
    return query


def _apply_sort(query, sort_by: str, sort_dir: str):
    if sort_by == "campus":
        query = query.join(Campus, Department.campus_id == Campus.id)
        column = Campus.code
    else:
        column = _SORT_COLUMNS[sort_by]
    return query.order_by(column.desc() if sort_dir == "desc" else column.asc())


def _scope_note(db: Session, scope: CampusScope, campus_id: uuid.UUID | None) -> str:
    if not scope.is_global:
        campus = db.get(Campus, scope.campus_id)
        label = campus.code if campus else "your campus"
        return f"Limited to your home campus ({label}). Any campus_id argument was ignored."
    if campus_id is None:
        return "Global access: results span all campuses."
    campus = db.get(Campus, campus_id)
    return f"Limited to campus {campus.code}." if campus else "Global access: results span all campuses."


def _check_code_conflict(
    db: Session, campus_id: uuid.UUID, code: str | None, *, exclude_id: uuid.UUID | None = None
) -> None:
    """Code+Campus uniqueness, enforced at the application level -- there is
    deliberately NO DB-level `UniqueConstraint("campus_id", "code")` yet (a
    live-data check before this epic's own migration found a genuine
    pre-existing collision; see
    `ebafe3ba100c_department_master_description_field.py`'s own docstring
    for the full story and why this app-level check exists in the meantime).
    Skipped entirely when `code` is null/blank -- nothing to collide on.
    Checked case-insensitively against every Department for the campus
    regardless of `is_active`, matching what the eventual DB constraint will
    enforce once the pre-existing collision is manually resolved.
    """
    if not code or not code.strip():
        return
    query = db.query(Department).filter(
        Department.campus_id == campus_id,
        func.lower(Department.code) == code.strip().lower(),
    )
    if exclude_id is not None:
        query = query.filter(Department.id != exclude_id)
    conflict = query.first()
    if conflict is None:
        return
    campus = db.get(Campus, campus_id)
    campus_label = campus.code if campus else str(campus_id)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f'Department Code "{code.strip()}" already exists for campus {campus_label}.',
    )


@router.get("", response_model=DepartmentListResponse)
def list_departments(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    campus_id: uuid.UUID | None = Query(None),
    parent_group: str | None = Query(None),
    sort_by: _SORT_FIELDS = Query("name"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> DepartmentListResponse:
    query = _base_query(
        db, scope, campus_id=campus_id, search=search, is_active=is_active, parent_group=parent_group
    )

    # category_counts is computed off this same base query (search/campus_id/
    # is_active applied, category NOT applied) via a cheap GROUP BY, before
    # `category` itself narrows `query` below -- so switching category tabs
    # never changes another tab's displayed count. Same pattern as
    # designations.py::list_designations.
    # One containment count per category rather than a GROUP BY: a
    # department now belongs to several categories at once, so the counts
    # deliberately OVERLAP and `ALL` is a distinct department count, not
    # their sum. (Postgres also forbids a set-returning `unnest` alongside an
    # aggregate in the same select list, so a single GROUP BY isn't available
    # here anyway.) Each count is served by the GIN index on the column.
    category_counts: dict[str, int] = {
        member.value: query.filter(Department.supported_categories.contains([member])).count()
        for member in StaffRoleCategoryEnum
    }
    category_counts["ALL"] = query.count()

    if category is not None:
        query = query.filter(Department.supported_categories.contains([category]))

    total = query.count()
    query = _apply_sort(query, sort_by, sort_dir)
    rows = query.offset(offset).limit(limit).all()
    return DepartmentListResponse(items=rows, total=total, limit=limit, offset=offset, category_counts=category_counts)


@router.get("/parent-groups", response_model=list[str])
def list_department_parent_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> list[str]:
    """Distinct, real, already-entered `parent_group` values -- sources the
    frontend's Parent Group filter dropdown from actual database records,
    never a hardcoded or guessed list (`parent_group` itself stays free text
    on the model, deliberately not a lookup table -- this is a read-only
    derived list for filter convenience, not a new persisted entity).
    Campus-scoped the same way `list_departments` is: a non-global role only
    ever sees parent groups that exist within its own campus."""
    query = db.query(Department.parent_group).filter(Department.parent_group.isnot(None)).distinct()
    if not scope.is_global:
        query = query.filter(Department.campus_id == scope.campus_id)
    return sorted(value for (value,) in query.all() if value)


@router.get("/export")
def export_departments(
    search: str | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    campus_id: uuid.UUID | None = Query(None),
    parent_group: str | None = Query(None),
    sort_by: _SORT_FIELDS = Query("name"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    """Same filters as `list_departments` minus pagination -- exports every
    matching row, not just one page. xlsx only, same as every other export
    in this app (Module 12's `/reports/{report_type}/export`)."""
    query = _base_query(
        db, scope, campus_id=campus_id, search=search, is_active=is_active, parent_group=parent_group
    )
    if category is not None:
        query = query.filter(Department.supported_categories.contains([category]))
    query = _apply_sort(query, sort_by, sort_dir)
    departments = query.options(selectinload(Department.campus)).all()

    rows = [
        {
            "campus_code": department.campus.code,
            "code": department.code,
            "name": department.name,
            "supported_categories": department.supported_categories,
            "parent_group": department.parent_group,
            "description": department.description,
            "is_active": department.is_active,
        }
        for department in departments
    ]
    excel_bytes = exports.build_department_export_excel(
        rows, datetime.now(timezone.utc), _scope_note(db, scope, campus_id)
    )
    filename = f"simats-departments-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> Department:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    _check_code_conflict(db, payload.campus_id, payload.code)

    department = Department(
        campus_id=payload.campus_id,
        name=payload.name,
        code=payload.code,
        # supported_categories stays optional at the API level (an existing
        # RBAC test relies on a category-less payload still reaching the role
        # check rather than 422ing first) -- but the column is NOT NULL, so
        # an omitted value falls back to the same "ambiguous ->
        # NON_TEACHING" default the original backfill used, rather than
        # passing an explicit None that would bypass the model's own
        # Python-side default. An explicitly EMPTY list is a different thing
        # and is rejected by the schema.
        supported_categories=payload.supported_categories or [StaffRoleCategoryEnum.NON_TEACHING],
        parent_group=payload.parent_group,
        description=payload.description,
        is_active=payload.is_active,
    )
    db.add(department)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Department",
        entity=department,
        campus_context_id=department.campus_id,
        after_state=_department_snapshot(department),
        request=request,
    )
    db.commit()
    db.refresh(department)
    return department


@router.patch("/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: uuid.UUID,
    payload: DepartmentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> Department:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if payload.code is not None:
        _check_code_conflict(db, department.campus_id, payload.code, exclude_id=department.id)

    before = _department_snapshot(department)
    if payload.name is not None:
        department.name = payload.name
    if payload.code is not None:
        department.code = payload.code
    if payload.supported_categories is not None:
        department.supported_categories = payload.supported_categories
    if payload.parent_group is not None:
        department.parent_group = payload.parent_group
    if payload.description is not None:
        department.description = payload.description
    if payload.is_active is not None:
        department.is_active = payload.is_active

    log_update(
        db,
        actor=current_user,
        entity_type="Department",
        entity=department,
        campus_context_id=department.campus_id,
        before_state=before,
        after_state=_department_snapshot(department),
        request=request,
    )
    db.commit()
    db.refresh(department)
    return department


@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> None:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Primary guard: active Users assigned to this department (User.
    # department_id, ondelete="SET NULL") -- the clearest, cheapest signal
    # that this department is still actually staffed.
    active_users = (
        db.query(User).filter(User.department_id == department.id, User.is_active.is_(True)).count()
    )
    if active_users > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{active_users} active user(s) reference this department, cannot delete.",
        )

    # Secondary guard: active Designations still mapped to this department
    # via the designation_departments M2M -- an indexed-PK join, cheap to
    # run, and worth checking because a still-active Designation Master
    # entry pointing only at this department would otherwise silently lose
    # its only valid department option. Deliberately NOT walking further
    # (SanctionedStrength/VacancyRequest keyed to this department) --  those
    # are RESTRICT FKs that a soft delete never actually touches, and
    # SanctionedStrength's own delete guard (working_count_for) already
    # covers the "still has active employees" case at that finer-grained
    # (department, designation) key.
    active_designations = (
        db.query(Designation)
        .filter(Designation.departments.any(Department.id == department.id), Designation.is_active.is_(True))
        .count()
    )
    if active_designations > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{active_designations} active designation(s) reference this department, cannot delete.",
        )

    before = _department_snapshot(department)
    department.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="Department",
        entity=department,
        campus_context_id=department.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


# --- Bulk upload (validate -> preview -> commit) ----------------------------
#
# Same shape as locations.py's own /bulk-upload/* family -- see
# app/services/department_import.py for the validate/commit logic. The
# batch-level history/error-report/original-file/undo endpoints deliberately
# stay in sanctioned_strength.py (same reuse locations.py/housekeeping_staff.py
# already rely on).


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: department_import.ImportRowResult) -> DepartmentBulkUploadRowPreview:
    return DepartmentBulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        campus_code=row.campus_code,
        department_code=row.department_code,
        department_name=row.department_name,
        supported_categories=row.supported_categories,
        parent_group=row.parent_group,
        description=row.description,
        is_active=row.is_active,
    )


@router.get("/bulk-upload/template")
def download_department_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> StreamingResponse:
    xlsx_bytes = department_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="department_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=DepartmentBulkUploadValidationResponse)
def validate_department_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> DepartmentBulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview, same no-server-side-cache contract as every other bulk
    upload in this app."""
    data = _read_upload_bytes(file)
    raw_rows = department_import.parse_rows(data, file.filename)
    validation = department_import.validate_rows(db, raw_rows)
    return DepartmentBulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=DepartmentBulkUploadCommitResponse)
def commit_department_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_DEPARTMENTS)),
) -> DepartmentBulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively, then applies every
    non-rejected row's UPSERT in one DB transaction -- same all-or-nothing
    contract as every other bulk-upload commit endpoint. Writes exactly one
    BulkUploadLog row (entity_type=DEPARTMENT) plus one BulkUploadRowLog row
    per non-rejected row (see app/services/department_import.py for why).

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = department_import.parse_rows(data, file.filename)
    validation = department_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.DEPARTMENT,
        uploaded_by_id=current_user.id,
        rows_total=validation.total,
        rows_created=validation.created_count,
        rows_updated=validation.updated_count,
        rows_rejected=validation.rejected_count,
        status=BulkUploadStatusEnum.COMPLETED,
        undo_deadline=now + timedelta(hours=24),
    )
    db.add(log)

    try:
        db.flush()  # assigns log.id, needed for the row-log FK

        department_import.commit_rows(db, validation=validation, bulk_upload_log_id=log.id)

        log_event(
            db,
            actor=current_user,
            action="DEPARTMENT_BULK_UPLOAD_COMMITTED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={
                "filename": log.filename,
                "rows_total": log.rows_total,
                "rows_created": log.rows_created,
                "rows_updated": log.rows_updated,
                "rows_rejected": log.rows_rejected,
            },
            request=request,
        )
    except Exception:
        db.rollback()
        raise

    db.commit()
    db.refresh(log)

    # Archival is attempted only now that the real records are safely
    # committed -- its outcome can never change whether this request
    # reports success, only whether `storage_warning` is set.
    storage_key, storage_error = storage.try_upload_bulk_upload_file(
        minio_client,
        bulk_upload_log_id=log.id,
        filename=file.filename or "upload",
        data=data,
        content_type=file.content_type or "application/octet-stream",
    )
    storage_warning = None
    if storage_key is not None:
        log.stored_file_object_key = storage_key
        db.commit()
    else:
        storage_warning = (
            "Workbook storage is temporarily unavailable. The file was successfully parsed, "
            "but the original workbook could not be archived."
        )
        log_event(
            db,
            actor=current_user,
            action="DEPARTMENT_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return DepartmentBulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )
