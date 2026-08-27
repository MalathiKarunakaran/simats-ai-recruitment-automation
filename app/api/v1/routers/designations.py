import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.bulk_upload_log import BulkUploadLog
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import (
    DESIGNATION_WRITE_ROLES,
    VACANCY_REQUEST_IN_FLIGHT_STATUSES,
    BulkUploadEntityTypeEnum,
    BulkUploadStatusEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.sanctioned_strength import SanctionedStrength
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.schemas.designation import DesignationCreate, DesignationListResponse, DesignationRead, DesignationUpdate
from app.schemas.designation_import import (
    DesignationBulkUploadCommitResponse,
    DesignationBulkUploadRowPreview,
    DesignationBulkUploadValidationResponse,
)
from app.services import designation_import, exports, storage
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/designations", tags=["designations"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as every other bulk-upload endpoint in this app


def _designation_snapshot(designation: Designation) -> dict:
    return {
        "name": designation.name,
        "category": designation.category.value,
        "qualification": designation.qualification,
        "min_experience": designation.min_experience,
        "employment_type": designation.employment_type.value,
        "required_skills": designation.required_skills,
        "is_active": designation.is_active,
        "department_ids": [str(department_id) for department_id in designation.department_ids],
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _resolve_departments(db: Session, department_ids: list[uuid.UUID]) -> list[Department]:
    if not department_ids:
        return []
    departments = db.query(Department).filter(Department.id.in_(department_ids)).all()
    found_ids = {department.id for department in departments}
    missing = [str(department_id) for department_id in department_ids if department_id not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown department_id(s): {', '.join(missing)}"
        )
    return departments


def _mismatched_departments(
    departments: list[Department], expected_category: StaffRoleCategoryEnum
) -> list[Department]:
    return [department for department in departments if department.category != expected_category]


def _validate_department_categories(
    departments: list[Department], expected_category: StaffRoleCategoryEnum
) -> None:
    """Every department linked to a designation must share the designation's
    own category -- a Teaching designation can never be mapped to a
    Non-Teaching/Housekeeping department, and vice versa. Enforced here (not
    just filtered in the frontend picker) so a direct API call can't create
    an invalid mapping either."""
    mismatched = _mismatched_departments(departments, expected_category)
    if not mismatched:
        return
    max_shown = 5
    names = [f"'{department.name}' is {department.category.value}" for department in mismatched[:max_shown]]
    label = ", ".join(names)
    if len(mismatched) > max_shown:
        label += f" (+{len(mismatched) - max_shown} more)"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Department(s) {label} but designation category is {expected_category.value}. "
            "All departments must match the designation's category."
        ),
    )


def _base_query(
    db: Session,
    *,
    department_id: uuid.UUID | None,
    search: str | None,
    is_active: bool | None,
):
    """Every filter shared between `list_designations` and
    `export_designations` EXCEPT `category` itself -- same split
    `departments.py::_base_query`/`designations.py::list_designations` (pre-
    `search`) already used: `category` is applied by each caller separately,
    after `list_designations` computes `category_counts` off this same base
    query.

    `search` (new -- previously done client-side in the frontend, see this
    epic's own task note) is a simple `ilike` on `name`, matching the exact
    client-side substring-match behavior it replaces.
    """
    query = db.query(Designation).options(selectinload(Designation.departments))
    if department_id is not None:
        query = query.filter(Designation.departments.any(Department.id == department_id))
    if search:
        query = query.filter(Designation.name.ilike(f"%{search}%"))
    if is_active is not None:
        query = query.filter(Designation.is_active == is_active)
    return query


@router.get("", response_model=DesignationListResponse)
def list_designations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    department_id: uuid.UUID | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> DesignationListResponse:
    query = _base_query(db, department_id=department_id, search=search, is_active=is_active)

    # category_counts is computed off this same base query (department_id/
    # is_active applied, category NOT applied) via a cheap GROUP BY, before
    # `category` itself narrows `query` below -- so switching category tabs
    # never changes another tab's displayed count.
    counts_query = query.with_entities(Designation.category, func.count(Designation.id)).group_by(
        Designation.category
    )
    category_counts: dict[str, int] = {member.value: 0 for member in StaffRoleCategoryEnum}
    for row_category, row_count in counts_query.all():
        category_counts[row_category.value] = row_count
    category_counts["ALL"] = sum(category_counts[member.value] for member in StaffRoleCategoryEnum)

    if category is not None:
        query = query.filter(Designation.category == category)
    total = query.count()
    rows = query.order_by(Designation.name).offset(offset).limit(limit).all()
    return DesignationListResponse(items=rows, total=total, limit=limit, offset=offset, category_counts=category_counts)


@router.get("/export")
def export_designations(
    department_id: uuid.UUID | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> StreamingResponse:
    """Same filters as `list_designations` minus pagination -- exports every
    matching row, not just one page. xlsx only, mirrors
    `departments.py::export_departments` exactly."""
    query = _base_query(db, department_id=department_id, search=search, is_active=is_active)
    if category is not None:
        query = query.filter(Designation.category == category)
    designations = query.order_by(Designation.name).all()

    rows = [
        {
            "name": designation.name,
            "category": designation.category.value,
            "department_codes": ", ".join(
                sorted(department.code for department in designation.departments if department.code)
            ),
            "qualification": designation.qualification,
            "min_experience": designation.min_experience,
            "employment_type": designation.employment_type.value,
            "required_skills": designation.required_skills,
            "is_active": designation.is_active,
        }
        for designation in designations
    ]
    excel_bytes = exports.build_designation_export_excel(rows, datetime.now(timezone.utc), "Designation Master")
    filename = f"simats-designations-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=DesignationRead, status_code=status.HTTP_201_CREATED)
def create_designation(
    payload: DesignationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> Designation:
    departments = _resolve_departments(db, payload.department_ids)
    _validate_department_categories(departments, payload.category)

    designation = Designation(
        name=payload.name,
        category=payload.category,
        qualification=payload.qualification,
        min_experience=payload.min_experience,
        employment_type=payload.employment_type,
        required_skills=payload.required_skills,
        is_active=payload.is_active,
    )
    designation.departments = departments
    db.add(designation)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Designation",
        entity=designation,
        campus_context_id=None,
        after_state=_designation_snapshot(designation),
        request=request,
    )
    db.commit()
    db.refresh(designation)
    return designation


@router.patch("/{designation_id}", response_model=DesignationRead)
def update_designation(
    designation_id: uuid.UUID,
    payload: DesignationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> Designation:
    designation = db.get(Designation, designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _designation_snapshot(designation)
    updates = payload.model_dump(exclude_unset=True, exclude={"department_ids"})
    for field, value in updates.items():
        setattr(designation, field, value)

    if payload.department_ids is not None:
        # `updates` (applied above) already assigned the new `category` onto
        # `designation` if it was part of this same request, so
        # `designation.category` is the effective category either way.
        departments = _resolve_departments(db, payload.department_ids)
        _validate_department_categories(departments, designation.category)
        designation.departments = departments
    elif payload.category is not None:
        # Category changed but department_ids left untouched -- check the
        # currently linked departments still hold up against the new
        # category rather than silently leaving a stale mismatch in place.
        mismatched = _mismatched_departments(designation.departments, designation.category)
        if mismatched:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Category changed to {designation.category.value} but {len(mismatched)} linked "
                    f"department(s) are not {designation.category.value}; provide department_ids to "
                    "update the mapping."
                ),
            )

    log_update(
        db,
        actor=current_user,
        entity_type="Designation",
        entity=designation,
        campus_context_id=None,
        before_state=before,
        after_state=_designation_snapshot(designation),
        request=request,
    )
    db.commit()
    db.refresh(designation)
    return designation


@router.delete("/{designation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_designation(
    designation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> None:
    designation = db.get(Designation, designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Primary guard: VacancyRequests still moving through the approval
    # pipeline for this designation (same VACANCY_REQUEST_IN_FLIGHT_STATUSES
    # set app/services/sanctioned_strength.py's availability formula and
    # vacancy_workflow.py's submit()-time enforcement already share) --
    # deactivating the designation mid-request would leave HR/Dean approving
    # a posting for a designation the master list no longer offers.
    in_flight_requests = (
        db.query(VacancyRequest)
        .filter(
            VacancyRequest.designation_id == designation.id,
            VacancyRequest.status.in_(VACANCY_REQUEST_IN_FLIGHT_STATUSES),
        )
        .count()
    )
    if in_flight_requests > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{in_flight_requests} in-flight vacancy request(s) reference this designation, cannot delete.",
        )

    # Secondary guard: active SanctionedStrength rows keyed to this
    # designation (the permanent establishment ceiling) -- an indexed
    # designation_id lookup, cheap to run, and the same "is this still a
    # live establishment entry" question sanctioned_strength.py's own
    # delete guard asks about a (department, designation) key's employees.
    active_sanctioned_strength = (
        db.query(SanctionedStrength)
        .filter(SanctionedStrength.designation_id == designation.id, SanctionedStrength.is_active.is_(True))
        .count()
    )
    if active_sanctioned_strength > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{active_sanctioned_strength} active sanctioned strength record(s) reference this "
                "designation, cannot delete."
            ),
        )

    before = _designation_snapshot(designation)
    designation.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="Designation",
        entity=designation,
        campus_context_id=None,
        before_state=before,
        request=request,
    )
    db.commit()


# --- Bulk upload (validate -> preview -> commit) ----------------------------
#
# Same shape as departments.py's own /bulk-upload/* family -- see
# app/services/designation_import.py for the validate/commit logic and the
# (Name, Category) natural-key reasoning. The batch-level history/
# error-report/original-file/undo endpoints deliberately stay in
# sanctioned_strength.py (same reuse departments.py/locations.py/
# housekeeping_staff.py already rely on).


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: designation_import.ImportRowResult) -> DesignationBulkUploadRowPreview:
    return DesignationBulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        merged_into_row=row.merged_into_row,
        name=row.name,
        category=row.category,
        department_codes=row.department_codes,
        qualification=row.qualification,
        min_experience=row.min_experience,
        employment_type=row.employment_type,
        required_skills=row.required_skills,
        is_active=row.is_active,
    )


@router.get("/bulk-upload/template")
def download_designation_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> StreamingResponse:
    xlsx_bytes = designation_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="designation_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=DesignationBulkUploadValidationResponse)
def validate_designation_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> DesignationBulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview, same no-server-side-cache contract as every other bulk
    upload in this app."""
    data = _read_upload_bytes(file)
    raw_rows = designation_import.parse_rows(data, file.filename)
    validation = designation_import.validate_rows(db, raw_rows)
    return DesignationBulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        merged_count=validation.merged_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=DesignationBulkUploadCommitResponse)
def commit_designation_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(require_roles(*DESIGNATION_WRITE_ROLES)),
) -> DesignationBulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively, then applies every
    non-rejected row's UPSERT in one DB transaction -- same all-or-nothing
    contract as every other bulk-upload commit endpoint. Writes exactly one
    BulkUploadLog row (entity_type=DESIGNATION) plus one BulkUploadRowLog row
    per non-rejected row (see app/services/designation_import.py for why).

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = designation_import.parse_rows(data, file.filename)
    validation = designation_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.DESIGNATION,
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

        designation_import.commit_rows(db, validation=validation, bulk_upload_log_id=log.id)

        log_event(
            db,
            actor=current_user,
            action="DESIGNATION_BULK_UPLOAD_COMMITTED",
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
            action="DESIGNATION_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return DesignationBulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        merged_count=validation.merged_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )
