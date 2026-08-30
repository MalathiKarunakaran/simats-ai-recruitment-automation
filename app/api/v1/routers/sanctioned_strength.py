"""Sanctioned Strength CRUD + history (zany-snuggling-pie.md Phase B, item
3). Writes are gated to SANCTIONED_STRENGTH_WRITE_ROLES (SUPER_ADMIN/
HR_ADMIN, both GLOBAL_SCOPE_ROLES) -- reads (history) are staff-only, same
`_staff_only` shape as every other master-data router in this codebase.

CREATE validates the designation's category matches the department's
category (item 6 -- a mismatch is a 400, not silently coerced). UPDATE only
ever touches approved_strength/effective_from/remarks -- every other column
(campus_id/department_id/designation_id/category) is immutable after
creation, and none of the Vacancy Register's derived read-model fields
(approved_count etc.) live on this table, so there's nothing else to
accidentally expose here. DELETE is a soft delete (is_active=False, never a
real DELETE) blocked with 409 while the (department, designation) key still
has active employees (item 7). Every write appends a SanctionedStrengthHistory
row (source=MANUAL) and calls the standard audit-log helpers.

Phase F (bulk upload) endpoints live at the bottom of this file
(`/bulk-upload/*`, `/bulk-uploads*`) -- see app/services/
sanctioned_strength_import.py for the validate/commit/undo logic. All of
them are gated to SANCTIONED_STRENGTH_WRITE_ROLES (not the broader
`_staff_only` used for plain history reads above) since bulk-upload
artifacts include the raw uploaded file and every batch's full row detail,
and only the two write-capable roles have any legitimate use for them.

Phase G adds `GET /views/housekeeping` immediately after the Non-Teaching
view handler -- same param-validation-then-delegate shape as the two
handlers above it, delegating to
`sanctioned_strength_views.list_housekeeping_strength_rows`. No new
mutating endpoint: this view's own "expand to roster" action reuses Phase
D's existing `/housekeeping-staff` CRUD unchanged (see that service
function's own docstring, judgment call #6).

Phase J (glowing-zooming-hamming.md) extends the bulk-upload machinery to
Location and HousekeepingStaff imports; the Department Master hardening epic
(2026-08-25) extends it a 3rd time, to Department imports; the starter
regulatory-eligibility-rules feature (backend Phase 1) extends it a 4th time,
to EligibilityRule imports; the Designation Master bulk-upload epic (backend
Phase 1) extends it a 5th time, to Designation imports. The entity-specific
write endpoints for these five (`/locations/bulk-upload/*`,
`/housekeeping-staff/bulk-upload/*`, `/departments/bulk-upload/*`,
`/eligibility-rules/bulk-upload/*`, `/designations/bulk-upload/*`) live in
their own routers (locations.py/housekeeping_staff.py/departments.py/
eligibility_rules.py/designations.py) -- only the 4 endpoints that were
already entity-agnostic in shape stay here and gain an `if/elif` dispatch on
`BulkUploadLog.entity_type`: `list_bulk_uploads` (optional `entity_type`
filter), `download_bulk_upload_error_report` (re-validates via the right
service module), `download_bulk_upload_original_file` (no dispatch needed --
raw byte proxy, already entity-agnostic), and `undo_bulk_upload`
(SANCTIONED_STRENGTH keeps its pre-existing SanctionedStrengthHistory-based
undo unchanged; LOCATION/HOUSEKEEPING_STAFF/DEPARTMENT/ELIGIBILITY_RULE/
DESIGNATION all use the same `BulkUploadRowLog`-based undo, deliberately
narrower in scope -- see that model's own docstring). This means a Location/
Department/EligibilityRule/Designation bulk-upload's history/undo lives
under a `/sanctioned-strength/bulk-uploads/*` URL -- a deliberate, if
slightly awkward-sounding, naming compromise in favor of genuine code reuse
over more duplicated endpoint families.
"""

import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import (
    campus_scope_note,
    CampusScope,
    DepartmentScope,
    enforce_campus_match,
    enforce_department_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    get_department_scope,
    require_roles,
)
from app.models.bulk_upload_log import BulkUploadLog
from app.models.bulk_upload_row_log import BulkUploadRowLog
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import (
    SANCTIONED_STRENGTH_WRITE_ROLES,
    BulkUploadEntityTypeEnum,
    BulkUploadStatusEnum,
    VacancyRequestStatusEnum,
    HousekeepingShiftEnum,
    SanctionedStrengthChangeSourceEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.schemas.common import PaginatedResponse
from app.schemas.sanctioned_strength import (
    SanctionedStrengthAvailabilityRead,
    SanctionedStrengthCreate,
    SanctionedStrengthHistoryRead,
    SanctionedStrengthRead,
    SanctionedStrengthUpdate,
)
from app.schemas.sanctioned_strength_import import (
    BulkUploadCommitResponse,
    BulkUploadLogRead,
    BulkUploadRowPreview,
    BulkUploadUndoResponse,
    BulkUploadValidationResponse,
)
from app.schemas.sanctioned_strength_views import (
    HousekeepingStrengthListResponse,
    NonTeachingStrengthListResponse,
    TeachingStrengthListResponse,
)
from app.services import (
    department_import,
    exports,
    designation_import,
    eligibility_rule_import,
    housekeeping_staff_import,
    location_import,
    sanctioned_strength_import,
    storage,
)
from app.services import sanctioned_strength_views
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.reporting import validate_campus_code
from app.services.sanctioned_strength import compute_availability_to_request, working_count_for
from app.services.storage import get_minio_client

router = APIRouter(prefix="/sanctioned-strength", tags=["sanctioned-strength"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as migration.py's tracker-workbook import

# Phase J (glowing-zooming-hamming.md) -- the 4 shared, entity-agnostic
# bulk-upload endpoints below (list/error-report/original-file/undo) must
# admit RECRUITMENT_OFFICER too, since Location's and HousekeepingStaff's
# own bulk-upload *write* endpoints (locations.py/housekeeping_staff.py)
# already do -- otherwise a RECRUITMENT_OFFICER could commit a Location bulk
# upload but then get a 403 trying to view/undo their own batch through
# these shared endpoints. Deliberately broader than
# SANCTIONED_STRENGTH_WRITE_ROLES/`_write_only` below, which stays scoped to
# the 3 Sanctioned-Strength-only endpoints (template/validate/commit) where
# only SUPER_ADMIN/HR_ADMIN may write. (The union of Sanctioned Strength's,
# Location's, and HousekeepingStaff's own write roles happens to equal this
# same 3-role set, since Location's/HousekeepingStaff's write roles are
# already supersets of SANCTIONED_STRENGTH_WRITE_ROLES. Department's/
# EligibilityRule's own write gates default to SUPER_ADMIN/HR_ADMIN only --
# a subset of this role set, not a superset -- so neither needs to widen
# this tuple further.)
#
# Designation Master bulk-upload epic (backend Phase 1) -- DESIGNATION_WRITE_ROLES
# (app/models/enums.py) is {SUPER_ADMIN, RECRUITMENT_COORDINATOR}, a
# genuinely different pairing than every other entity's own write roles
# above (it does NOT include HR_ADMIN/RECRUITMENT_OFFICER, and DOES include
# RECRUITMENT_COORDINATOR, which no other entity's write gate does) -- so
# RECRUITMENT_COORDINATOR must be added here too, or exactly the same "commit
# succeeds, then a 403 trying to view/undo it" gap this comment already
# describes for RECRUITMENT_OFFICER would reappear for Designation batches.
_SHARED_BULK_UPLOAD_ROLES = (
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.RECRUITMENT_OFFICER,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
)


def _write_only(current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES))) -> User:
    return current_user


def _shared_bulk_upload_write(current_user: User = Depends(require_roles(*_SHARED_BULK_UPLOAD_ROLES))) -> User:
    return current_user


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: sanctioned_strength_import.ImportRowResult) -> BulkUploadRowPreview:
    return BulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        campus_code=row.campus_code,
        department_name=row.department_name,
        designation_name=row.designation_name,
        approved_strength=row.approved_strength,
        effective_from=row.effective_from,
        remarks=row.remarks,
    )


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _snapshot(row: SanctionedStrength) -> dict:
    return {
        "campus_id": row.campus_id,
        "department_id": row.department_id,
        "designation_id": row.designation_id,
        "location_id": row.location_id,
        "category": row.category.value,
        "approved_strength": row.approved_strength,
        "working_override": row.working_override,
        "effective_from": row.effective_from,
        "remarks": row.remarks,
        "is_active": row.is_active,
    }


def _get_or_404_scoped(
    db: Session,
    sanctioned_strength_id: uuid.UUID,
    scope: CampusScope,
    scope_dept: DepartmentScope,
) -> SanctionedStrength:
    row = db.get(SanctionedStrength, sanctioned_strength_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, row.campus_id)
    enforce_department_match(scope_dept, row.department_id)
    return row


@router.get("/views/teaching", response_model=TeachingStrengthListResponse)
def list_teaching_strength_view(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("department_name"),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    row_status: str | None = Query(None, alias="status"),
    vacancy: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> TeachingStrengthListResponse:
    """Phase E (glowing-zooming-hamming.md) -- the designation-level Teaching
    operational view, one row per current-effective SanctionedStrength row
    with category == TEACHING. See app/services/sanctioned_strength_views.py
    for every field's derivation and the `status` priority order. Same
    param-validation-then-delegate shape as
    GET /departments/vacancy-register (app/api/v1/routers/vacancy_register.py):
    sort_by/sort_dir/status validated against their own value tuples with a
    422 on an unknown value, campus_code validated via the shared
    validate_campus_code helper.
    """
    if sort_by not in sanctioned_strength_views.TEACHING_STRENGTH_SORT_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_by '{sort_by}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_SORT_FIELDS)}."
            ),
        )
    if sort_dir not in sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_dir '{sort_dir}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS)}."
            ),
        )
    if row_status is not None and row_status not in sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown status '{row_status}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES)}."
            ),
        )
    validated_campus_code = validate_campus_code(campus_code)

    rows, total, status_counts, approved_total, working_total, vacancy_total = (
        sanctioned_strength_views.list_teaching_strength_rows(
            db,
            scope,
            scope_dept,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
            campus_code=validated_campus_code,
            department_id=department_id,
            designation_id=designation_id,
            location_id=location_id,
            search=search,
            status=row_status,
            vacancy=vacancy,
        )
    )
    return TeachingStrengthListResponse(
        items=rows,
        total=total,
        limit=limit,
        offset=offset,
        status_counts=status_counts,
        approved_total=approved_total,
        working_total=working_total,
        vacancy_total=vacancy_total,
    )


@router.get("/views/non-teaching", response_model=NonTeachingStrengthListResponse)
def list_non_teaching_strength_view(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("department_name"),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    row_status: str | None = Query(None, alias="status"),
    vacancy: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> NonTeachingStrengthListResponse:
    """Phase F (glowing-zooming-hamming.md) -- the designation-level
    Non-Teaching operational view, one row per current-effective
    SanctionedStrength row with category == NON_TEACHING. Identical shape to
    `list_teaching_strength_view` just above (same param set, same
    validation-then-delegate structure, same sort/status value tuples --
    see app/services/sanctioned_strength_views.py's module docstring for why
    the TEACHING_STRENGTH_* constant names are reused here rather than
    duplicated under a NON_TEACHING_STRENGTH_* name) -- the two handlers only
    differ in which `category` they pass into the shared
    `list_strength_view_rows` service function and which response schema
    they wrap the result in.
    """
    if sort_by not in sanctioned_strength_views.TEACHING_STRENGTH_SORT_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_by '{sort_by}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_SORT_FIELDS)}."
            ),
        )
    if sort_dir not in sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_dir '{sort_dir}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS)}."
            ),
        )
    if row_status is not None and row_status not in sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown status '{row_status}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES)}."
            ),
        )
    validated_campus_code = validate_campus_code(campus_code)

    rows, total, status_counts, approved_total, working_total, vacancy_total = (
        sanctioned_strength_views.list_strength_view_rows(
            db,
            scope,
            scope_dept,
            category=StaffRoleCategoryEnum.NON_TEACHING,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
            campus_code=validated_campus_code,
            department_id=department_id,
            designation_id=designation_id,
            location_id=location_id,
            search=search,
            status=row_status,
            vacancy=vacancy,
        )
    )
    return NonTeachingStrengthListResponse(
        items=rows,
        total=total,
        limit=limit,
        offset=offset,
        status_counts=status_counts,
        approved_total=approved_total,
        working_total=working_total,
        vacancy_total=vacancy_total,
    )


@router.get("/views/housekeeping", response_model=HousekeepingStrengthListResponse)
def list_housekeeping_strength_view(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("location_name"),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    block: str | None = Query(None),
    floor_venue: str | None = Query(None),
    shift: HousekeepingShiftEnum | None = Query(None),
    search: str | None = Query(None),
    row_status: str | None = Query(None, alias="status"),
    vacancy: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> HousekeepingStrengthListResponse:
    """Phase G (glowing-zooming-hamming.md) -- the Location-grained
    Housekeeping operational view, one row per Location with at least one
    current-effective HOUSEKEEPING SanctionedStrength row against it. See
    app/services/sanctioned_strength_views.py for every field's derivation,
    the full set of judgment calls this phase resolved, and why this view is
    NOT a third `category=` value fed into `list_strength_view_rows` the way
    Non-Teaching was -- it's a genuinely different (Location, not
    department/designation) grain. Same param-validation-then-delegate shape
    as `list_teaching_strength_view`/`list_non_teaching_strength_view`
    above, except `sort_by`/`status` are validated against this view's own
    `HOUSEKEEPING_STRENGTH_SORT_FIELDS` (a different column set -- no
    department/designation columns exist here) while `sort_dir`/`status`
    still reuse the shared `TEACHING_STRENGTH_*` vocabularies (see that
    module's docstring for why those two are genuinely shared). `shift` gets
    free enum validation from FastAPI/Pydantic (422 on an invalid value)
    rather than a manual check, matching
    app/api/v1/routers/housekeeping_staff.py's own `shift` query param.
    """
    if sort_by not in sanctioned_strength_views.HOUSEKEEPING_STRENGTH_SORT_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_by '{sort_by}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.HOUSEKEEPING_STRENGTH_SORT_FIELDS)}."
            ),
        )
    if sort_dir not in sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown sort_dir '{sort_dir}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_SORT_DIRECTIONS)}."
            ),
        )
    if row_status is not None and row_status not in sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown status '{row_status}'. Valid values: "
                f"{', '.join(sanctioned_strength_views.TEACHING_STRENGTH_STATUS_VALUES)}."
            ),
        )
    validated_campus_code = validate_campus_code(campus_code)

    rows, total, status_counts, required_total, available_total, vacancy_total = (
        sanctioned_strength_views.list_housekeeping_strength_rows(
            db,
            scope,
            scope_dept,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
            campus_code=validated_campus_code,
            location_id=location_id,
            block=block,
            floor_venue=floor_venue,
            shift=shift.value if shift is not None else None,
            search=search,
            status=row_status,
            vacancy=vacancy,
        )
    )
    return HousekeepingStrengthListResponse(
        items=rows,
        total=total,
        limit=limit,
        offset=offset,
        status_counts=status_counts,
        required_total=required_total,
        available_total=available_total,
        vacancy_total=vacancy_total,
    )


# Export cap. Deliberately far above any realistic register size rather than
# paginated: an export that silently stopped at N rows would be worse than one
# that is simply large. `list_strength_view_rows` is a single query either way.
_EXPORT_MAX_ROWS = 50_000


@router.get("/views/{view}/export")
def export_strength_view(
    view: Literal["teaching", "non-teaching", "housekeeping"],
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    block: str | None = Query(None),
    floor_venue: str | None = Query(None),
    shift: HousekeepingShiftEnum | None = Query(None),
    search: str | None = Query(None),
    row_status: str | None = Query(None, alias="status"),
    vacancy: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> StreamingResponse:
    """xlsx export of one Sanctioned Strength view, minus pagination.

    Unlike every other master-data export in this app, Sanctioned Strength has
    no single flat list endpoint -- it is presented as three tabbed views with
    two different row shapes. So the view is part of the path and the export
    mirrors whichever tab the user is looking at, rather than inventing a
    fourth "combined" shape that matches nothing on screen.

    Teaching and Non-Teaching share `_StrengthViewRowBase`; Housekeeping is
    Location-grained (required/available rather than approved/working). The
    department/designation filters apply only to the first two, and the
    block/floor_venue/shift filters only to Housekeeping -- passing an
    irrelevant one is ignored rather than a 422, matching how each view's own
    list endpoint already treats params it does not define.
    """
    validated_campus_code = validate_campus_code(campus_code)
    housekeeping = view == "housekeeping"

    if housekeeping:
        rows, _total, _counts, _a, _w, _v = sanctioned_strength_views.list_housekeeping_strength_rows(
            db,
            scope,
            scope_dept,
            limit=_EXPORT_MAX_ROWS,
            offset=0,
            sort_by=sort_by or "location_name",
            sort_dir=sort_dir,
            campus_code=validated_campus_code,
            location_id=location_id,
            block=block,
            floor_venue=floor_venue,
            shift=shift.value if shift else None,
            search=search,
            status=row_status,
            vacancy=vacancy,
        )
        sheet_title = "Housekeeping Strength"
    else:
        category = (
            StaffRoleCategoryEnum.TEACHING if view == "teaching" else StaffRoleCategoryEnum.NON_TEACHING
        )
        rows, _total, _counts, _a, _w, _v = sanctioned_strength_views.list_strength_view_rows(
            db,
            scope,
            scope_dept,
            category=category,
            limit=_EXPORT_MAX_ROWS,
            offset=0,
            sort_by=sort_by or "department_name",
            sort_dir=sort_dir,
            campus_code=validated_campus_code,
            department_id=department_id,
            designation_id=designation_id,
            location_id=location_id,
            search=search,
            status=row_status,
            vacancy=vacancy,
        )
        sheet_title = "Teaching Strength" if view == "teaching" else "Non-Teaching Strength"

    # campus_code, not campus_id, is this family's narrowing param -- resolve
    # it so the workbook's Scope line reads the same as every other export's.
    scope_campus_id = None
    if validated_campus_code:
        campus_row = db.query(Campus).filter(Campus.code == validated_campus_code).one_or_none()
        scope_campus_id = campus_row.id if campus_row else None

    excel_bytes = exports.build_strength_view_export_excel(
        rows,
        datetime.now(timezone.utc),
        campus_scope_note(db, scope, scope_campus_id),
        housekeeping=housekeeping,
        sheet_title=sheet_title,
    )
    filename = f"simats-sanctioned-strength-{view}-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/availability", response_model=SanctionedStrengthAvailabilityRead)
def get_sanctioned_strength_availability(
    campus_id: uuid.UUID = Query(...),
    department_id: uuid.UUID = Query(...),
    designation_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> dict:
    """Phase E's availability strip (`{approved, working, vacant,
    already_requested, available_to_request}`) for one (campus, department,
    designation) key -- shown on the New Vacancy Request form once
    campus+department+designation are picked, and read by nothing else on
    the backend side (submit()'s own enforcement calls the shared
    `compute_availability_to_request` service function directly rather than
    this HTTP endpoint). A live query every time, no new stored reservation
    row -- see app/services/sanctioned_strength.py for the formula.
    """
    campus = db.get(Campus, campus_id)
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, campus.id)
    if db.get(Department, department_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_department_match(scope_dept, department_id)
    if db.get(Designation, designation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return compute_availability_to_request(
        db, campus_id=campus_id, department_id=department_id, designation_id=designation_id
    )


@router.post("", response_model=SanctionedStrengthRead, status_code=status.HTTP_201_CREATED)
def create_sanctioned_strength(
    payload: SanctionedStrengthCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
) -> SanctionedStrength:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")
    designation = db.get(Designation, payload.designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown designation_id")

    # Item 6: block designations the department is not permitted to contain.
    # A membership test since 2026-08-28 -- a department supports several
    # staff categories at once, so equality against a single department
    # category was wrong (see `Department.supported_categories`).
    if not department.supports(designation.category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Department {department.code or department.name} does not support "
                f"{designation.category.value} staff."
            ),
        )

    # Phase C (glowing-zooming-hamming.md) -- Housekeeping rows must carry a
    # location_id (Housekeeping strength is tracked per Location, not just
    # per department/designation); Teaching/Non-Teaching stay fully optional.
    if designation.category == StaffRoleCategoryEnum.HOUSEKEEPING and payload.location_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location is required for Housekeeping sanctioned strength records.",
        )
    if payload.location_id is not None and db.get(Location, payload.location_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")

    row = SanctionedStrength(
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        designation_id=payload.designation_id,
        location_id=payload.location_id,
        category=designation.category,
        approved_strength=payload.approved_strength,
        working_override=payload.working_override,
        effective_from=payload.effective_from,
        remarks=payload.remarks,
        created_by_id=current_user.id,
    )
    db.add(row)
    db.flush()

    db.add(
        SanctionedStrengthHistory(
            sanctioned_strength_id=row.id,
            old_value=None,
            new_value=row.approved_strength,
            changed_by_id=current_user.id,
            source=SanctionedStrengthChangeSourceEnum.MANUAL,
        )
    )

    log_create(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{sanctioned_strength_id}", response_model=SanctionedStrengthRead)
def update_sanctioned_strength(
    sanctioned_strength_id: uuid.UUID,
    payload: SanctionedStrengthUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> SanctionedStrength:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope, scope_dept)
    before = _snapshot(row)
    old_approved_strength = row.approved_strength

    if payload.approved_strength is not None:
        row.approved_strength = payload.approved_strength
    if payload.effective_from is not None:
        row.effective_from = payload.effective_from
    if payload.remarks is not None:
        row.remarks = payload.remarks
    # Keyed off model_fields_set, not `is not None`, because null is a
    # MEANINGFUL value here: sending working_override=null clears the manual
    # figure and hands the row back to the live Employee/HousekeepingStaff
    # count, while omitting the key leaves any existing override alone. The
    # `is not None` checks above cannot express that difference.
    if "working_override" in payload.model_fields_set:
        row.working_override = payload.working_override
    if payload.location_id is not None:
        if db.get(Location, payload.location_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")
        row.location_id = payload.location_id
    row.updated_by_id = current_user.id

    # Only write a history row when approved_strength actually changed --
    # editing effective_from/remarks alone is not a strength revision.
    if payload.approved_strength is not None and payload.approved_strength != old_approved_strength:
        db.add(
            SanctionedStrengthHistory(
                sanctioned_strength_id=row.id,
                old_value=old_approved_strength,
                new_value=row.approved_strength,
                changed_by_id=current_user.id,
                source=SanctionedStrengthChangeSourceEnum.MANUAL,
            )
        )

    log_update(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{sanctioned_strength_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sanctioned_strength(
    sanctioned_strength_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> None:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope, scope_dept)

    # Item 7: block the soft delete while active employees still occupy this
    # (department, designation) key -- reuses the same working_count_for the
    # designation breakdown uses, so the two never disagree. Phase D
    # (glowing-zooming-hamming.md) -- pass this row's own category/
    # location_id through so a HOUSEKEEPING row's guard counts live
    # HousekeepingStaff, not (always-zero) Employee rows.
    working = working_count_for(
        db,
        department_id=row.department_id,
        designation_id=row.designation_id,
        category=row.category,
        location_id=row.location_id,
    )
    if working > 0:
        occupant_noun = "housekeeping staff" if row.category == StaffRoleCategoryEnum.HOUSEKEEPING else "employee(s)"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{working} active {occupant_noun} in this designation, cannot delete.",
        )

    before = _snapshot(row)
    row.is_active = False
    row.updated_by_id = current_user.id

    log_delete(
        db,
        actor=current_user,
        entity_type="SanctionedStrength",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


@router.get("/{sanctioned_strength_id}/history", response_model=PaginatedResponse[SanctionedStrengthHistoryRead])
def list_sanctioned_strength_history(
    sanctioned_strength_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    scope_dept: DepartmentScope = Depends(get_department_scope),
) -> PaginatedResponse[SanctionedStrengthHistoryRead]:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope, scope_dept)

    query = (
        db.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .order_by(SanctionedStrengthHistory.changed_at.desc())
    )
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


# --- Phase F: bulk upload (validate -> preview -> commit) ------------------
#
# Route depths here never collide with the `/{sanctioned_strength_id}...`
# routes above: "bulk-upload"/"bulk-uploads" are literal path segments (not
# a UUID param), and validate/commit/template sit at the same depth as each
# other but are distinguished by their own literal final segment, so
# registration order doesn't matter the way it does in reports.py.


@router.get("/bulk-upload/template")
def download_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_only),
) -> StreamingResponse:
    """Live-generated on every request (unlike migration.py's static
    tracker-template FileResponse) so the "Master Lists" sheet always
    reflects current department/designation master data -- see
    app/services/sanctioned_strength_import.py::build_bulk_upload_template_xlsx.
    """
    xlsx_bytes = sanctioned_strength_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="sanctioned_strength_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=BulkUploadValidationResponse)
def validate_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_only),
) -> BulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview. No server-side caching of the parsed rows between this
    call and `/bulk-upload/commit` (the plan's deliberate simplicity choice)
    -- the client re-sends the same file to commit.
    """
    data = _read_upload_bytes(file)
    raw_rows = sanctioned_strength_import.parse_rows(data, file.filename)
    validation = sanctioned_strength_import.validate_rows(db, raw_rows)
    return BulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=BulkUploadCommitResponse)
def commit_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(_write_only),
) -> BulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively (never trusts a stale
    client-held preview -- see `validate_rows`), then applies every non-
    rejected row's UPSERT in one DB transaction: nothing is committed until
    the very end, so an unexpected failure partway through (defense in
    depth -- validate_rows should already have caught anything that would
    fail here) leaves nothing persisted. Writes exactly one BulkUploadLog
    row summarizing the batch.

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring for the full "Could not reach object storage" bug this fixes
    and why): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = sanctioned_strength_import.parse_rows(data, file.filename)
    validation = sanctioned_strength_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.SANCTIONED_STRENGTH,
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
        db.flush()  # assigns log.id, needed for the history FK

        sanctioned_strength_import.commit_rows(
            db, validation=validation, actor=current_user, bulk_upload_log_id=log.id
        )

        log_event(
            db,
            actor=current_user,
            action="SANCTIONED_STRENGTH_BULK_UPLOAD_COMMITTED",
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
            action="SANCTIONED_STRENGTH_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return BulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )


@router.get("/bulk-uploads", response_model=PaginatedResponse[BulkUploadLogRead])
def list_bulk_uploads(
    entity_type: BulkUploadEntityTypeEnum | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_shared_bulk_upload_write),
) -> PaginatedResponse[BulkUploadLogRead]:
    """Not campus-scoped -- a single upload batch can span rows across
    multiple campuses, so there is no single `campus_id` to gate on (unlike
    the single-resource SanctionedStrength endpoints above). `entity_type`
    (Phase J) is an optional filter, additive same as every other list-filter
    added this epic -- omitting it returns every batch regardless of which
    entity it imported."""
    query = db.query(BulkUploadLog)
    if entity_type is not None:
        query = query.filter(BulkUploadLog.entity_type == entity_type)
    query = query.order_by(BulkUploadLog.uploaded_at.desc())
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


def _get_bulk_upload_log_or_404(db: Session, bulk_upload_log_id: uuid.UUID) -> BulkUploadLog:
    log = db.get(BulkUploadLog, bulk_upload_log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return log


def _import_module_for(entity_type: BulkUploadEntityTypeEnum):
    """The plain `if/elif` dispatch on `entity_type` the 4 shared endpoints
    below use, matching this codebase's own preference for explicit code
    over indirection at this scale (4 known values, not a registry)."""
    if entity_type == BulkUploadEntityTypeEnum.SANCTIONED_STRENGTH:
        return sanctioned_strength_import
    if entity_type == BulkUploadEntityTypeEnum.LOCATION:
        return location_import
    if entity_type == BulkUploadEntityTypeEnum.HOUSEKEEPING_STAFF:
        return housekeeping_staff_import
    if entity_type == BulkUploadEntityTypeEnum.DEPARTMENT:
        return department_import
    if entity_type == BulkUploadEntityTypeEnum.ELIGIBILITY_RULE:
        return eligibility_rule_import
    if entity_type == BulkUploadEntityTypeEnum.DESIGNATION:
        return designation_import
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unknown bulk upload entity type")


@router.get("/bulk-upload/{bulk_upload_log_id}/error-report")
def download_bulk_upload_error_report(
    bulk_upload_log_id: uuid.UUID,
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(_shared_bulk_upload_write),
) -> StreamingResponse:
    """Re-downloads the original file from MinIO and re-runs `validate_rows`
    against *current* DB state (rather than caching the original per-row
    rejection reasons anywhere) to rebuild the rejected-row set -- consistent
    with the plan's "no new session/cache infrastructure" choice for this
    feature. This means a reason can theoretically read slightly differently
    if master data changed since the original upload (e.g. a department was
    renamed) -- an accepted, documented edge case, not a bug.

    Phase J -- dispatches to the right service module via `log.entity_type`
    (`_import_module_for`) so this one endpoint serves all 3 entity types'
    error reports.
    """
    log = _get_bulk_upload_log_or_404(db, bulk_upload_log_id)
    if log.stored_file_object_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not available")

    module = _import_module_for(log.entity_type)
    data = storage.download_bulk_upload_file_bytes(minio_client, log.stored_file_object_key)
    raw_rows = module.parse_rows(data, log.filename)
    validation = module.validate_rows(db, raw_rows)
    rejected_rows = [row for row in validation.rows if row.status == "rejected"]

    xlsx_bytes = module.build_error_report_xlsx(log, rejected_rows)
    filename = f"{log.entity_type.value.lower()}-bulk-upload-{log.id}-errors.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/bulk-uploads/{bulk_upload_log_id}/original-file")
def download_bulk_upload_original_file(
    bulk_upload_log_id: uuid.UUID,
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(_shared_bulk_upload_write),
) -> StreamingResponse:
    """Proxied download, same shape as candidates.py's resume download --
    never a presigned URL (see app/services/storage.py)."""
    log = _get_bulk_upload_log_or_404(db, bulk_upload_log_id)
    if log.stored_file_object_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not available")

    data = storage.download_bulk_upload_file_bytes(minio_client, log.stored_file_object_key)
    filename = log.stored_file_object_key.rsplit("/", 1)[-1]
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _undo_sanctioned_strength(
    db: Session, *, log: BulkUploadLog, current_user: User, request: Request
) -> BulkUploadUndoResponse:
    """Reverts every SanctionedStrengthHistory row this batch touched. For a
    row this batch *updated* (`old_value` is a real prior number), reverting
    means writing that `old_value` back onto the live row. For a row this
    batch *created* (`old_value` is NULL -- there was no prior sanctioned row
    at all), there is no valid number to "write back" (approved_strength is
    NOT NULL and CHECK >= 0) -- undoing a CREATE instead soft-deletes the row
    it created (`is_active=False`), which is the only meaningful way to undo
    a row's entire existence. Each reverted row gets a fresh
    SanctionedStrengthHistory entry (source=MANUAL, since the undo itself is
    a manual admin action, still linked back to this batch's
    bulk_upload_log_id for traceability) -- never a silent mutation.

    Known limitation, not fixed here: if a row was *also* manually edited
    (via PATCH) after this batch's upload but before the undo, this still
    reverts to this batch's own `old_value`, discarding that later manual
    edit -- the 24h window bounds how often this can realistically happen,
    and the plan doesn't ask for finer-grained conflict detection.
    """
    history_rows = (
        db.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.bulk_upload_log_id == log.id)
        .all()
    )

    reverted = 0
    for entry in history_rows:
        row = db.get(SanctionedStrength, entry.sanctioned_strength_id)
        if row is None:
            continue

        if entry.old_value is None:
            before_value = row.approved_strength
            row.is_active = False
            row.updated_by_id = current_user.id
            db.add(
                SanctionedStrengthHistory(
                    sanctioned_strength_id=row.id,
                    old_value=before_value,
                    new_value=before_value,
                    changed_by_id=current_user.id,
                    source=SanctionedStrengthChangeSourceEnum.MANUAL,
                    bulk_upload_log_id=log.id,
                )
            )
        else:
            before_value = row.approved_strength
            row.approved_strength = entry.old_value
            row.updated_by_id = current_user.id
            db.add(
                SanctionedStrengthHistory(
                    sanctioned_strength_id=row.id,
                    old_value=before_value,
                    new_value=entry.old_value,
                    changed_by_id=current_user.id,
                    source=SanctionedStrengthChangeSourceEnum.MANUAL,
                    bulk_upload_log_id=log.id,
                )
            )
        reverted += 1

    log_event(
        db,
        actor=current_user,
        action="SANCTIONED_STRENGTH_BULK_UPLOAD_UNDONE",
        entity_type="BulkUploadLog",
        entity_id=log.id,
        after_state={"reverted_history_count": reverted},
        request=request,
    )

    return BulkUploadUndoResponse(id=log.id, status=log.status, reverted_history_count=reverted, not_reverted_count=0)


def _undo_vacancy_request_batch(
    db: Session, *, log: BulkUploadLog, row_logs: list, current_user: User, request: Request
) -> BulkUploadUndoResponse:
    """Undo a VACANCY_REQUEST batch by CANCELLING the drafts it created.

    Three ways this differs from the master-data undo beside it, all forced by
    what a vacancy request actually is:

    - **Cancel, not soft-delete.** VacancyRequest has no `is_active`; CANCELLED
      is its own terminal "no longer wanted" state, distinct from REJECTED
      (which means an approver refused it) and CLOSED (filled).
    - **Only rows still in DRAFT are reverted.** Unlike a Location, a request
      can move on by itself inside the 24h undo window -- someone may have
      submitted or even approved it. Cancelling that would be destructive, so
      anything past DRAFT is counted into `not_reverted_count` and left alone,
      the same way an *updated* master-data row is.
    - **No status choke-point call.** `vacancy_workflow.cancel()` expects an
      approved vacancy and job posting and enforces committed-candidate rules;
      none of that can exist for an untouched DRAFT, and routing through it
      would mean fetching two relationships that are always None. The status
      write is confined here and stays inside the DRAFT-only guard above.
    """
    reverted = 0
    not_reverted = 0
    now = datetime.now(timezone.utc)

    for entry in row_logs:
        if not entry.was_created:
            # This importer never updates, so this should not occur -- kept
            # for parity with the shared undo's own contract.
            not_reverted += 1
            continue
        vr = db.get(VacancyRequest, entry.entity_id)
        if vr is None:
            continue
        if vr.status != VacancyRequestStatusEnum.DRAFT:
            not_reverted += 1
            continue
        vr.status = VacancyRequestStatusEnum.CANCELLED
        vr.cancelled_by_id = current_user.id
        vr.cancelled_at = now
        vr.cancellation_reason = f"Bulk upload {log.filename} undone"
        reverted += 1

    log_event(
        db,
        actor=current_user,
        action="VACANCY_REQUEST_BULK_UPLOAD_UNDONE",
        entity_type="BulkUploadLog",
        entity_id=log.id,
        after_state={"reverted_count": reverted, "not_reverted_count": not_reverted},
        request=request,
    )
    # The caller (undo_bulk_upload) already stamps log.status/undone_at/
    # undone_by_id and commits -- this returns the same shape the shared
    # row-log undo does and leaves the transaction to it.
    return BulkUploadUndoResponse(
        id=log.id, status=log.status, reverted_history_count=reverted, not_reverted_count=not_reverted
    )


def _undo_row_log_based(
    db: Session, *, log: BulkUploadLog, current_user: User, request: Request
) -> BulkUploadUndoResponse:
    """Undo for LOCATION/HOUSEKEEPING_STAFF/DEPARTMENT/ELIGIBILITY_RULE/
    DESIGNATION/VACANCY_REQUEST batches -- deliberately narrower in scope than
    Sanctioned Strength's own undo above.

    VACANCY_REQUEST is handled separately below and does NOT soft-delete: a
    vacancy request has no `is_active` column, it has a status lifecycle, and
    its established "this is no longer wanted" state is CANCELLED. It is also
    the only entity here whose rows can move on by themselves between the
    import and the undo -- someone can submit a bulk-created draft within the
    24h window -- so only rows still sitting in DRAFT are reverted. Cancelling
    a request already in an approval chain would be a destructive surprise,
    not an undo. None of these 4 entities has a permanent old-value history
    table, so there is no way to revert a row this batch *updated* back to
    what it looked like before (`BulkUploadRowLog` only records whether a
    row was created or updated, not the prior values) -- see
    app/models/bulk_upload_row_log.py's own docstring for why re-deriving
    this after the fact from the stored file doesn't work either. Only rows
    this batch *created* (`was_created=True`) can be safely undone, by
    soft-deleting them (`is_active=False`, each entity's own established
    soft-delete convention). Rows this batch updated are skipped and counted
    in `not_reverted_count` so the caller can surface "N of M rows could not
    be reverted" rather than silently doing nothing for them.
    """
    row_logs = db.query(BulkUploadRowLog).filter(BulkUploadRowLog.bulk_upload_log_id == log.id).all()

    if log.entity_type == BulkUploadEntityTypeEnum.VACANCY_REQUEST:
        return _undo_vacancy_request_batch(
            db, log=log, row_logs=row_logs, current_user=current_user, request=request
        )

    if log.entity_type == BulkUploadEntityTypeEnum.LOCATION:
        model = Location
    elif log.entity_type == BulkUploadEntityTypeEnum.DEPARTMENT:
        model = Department
    elif log.entity_type == BulkUploadEntityTypeEnum.ELIGIBILITY_RULE:
        model = EligibilityRule
    elif log.entity_type == BulkUploadEntityTypeEnum.DESIGNATION:
        model = Designation
    else:
        model = HousekeepingStaff

    reverted = 0
    not_reverted = 0
    for entry in row_logs:
        if not entry.was_created:
            not_reverted += 1
            continue
        entity = db.get(model, entry.entity_id)
        if entity is None:
            # Entity was hard-deleted out-of-band, which nothing in this
            # codebase does -- defensive, not expected in practice.
            continue
        entity.is_active = False
        if hasattr(entity, "updated_by_id"):
            entity.updated_by_id = current_user.id
        reverted += 1

    log_event(
        db,
        actor=current_user,
        action=f"{log.entity_type.value}_BULK_UPLOAD_UNDONE",
        entity_type="BulkUploadLog",
        entity_id=log.id,
        after_state={"reverted_count": reverted, "not_reverted_count": not_reverted},
        request=request,
    )

    return BulkUploadUndoResponse(
        id=log.id, status=log.status, reverted_history_count=reverted, not_reverted_count=not_reverted
    )


@router.post("/bulk-uploads/{bulk_upload_log_id}/undo", response_model=BulkUploadUndoResponse)
def undo_bulk_upload(
    bulk_upload_log_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_shared_bulk_upload_write),
) -> BulkUploadUndoResponse:
    """Only within the stored 24h `undo_deadline`. Dispatches on
    `log.entity_type` (Phase J): SANCTIONED_STRENGTH keeps its pre-existing
    SanctionedStrengthHistory-based undo (`_undo_sanctioned_strength`)
    unchanged; LOCATION/HOUSEKEEPING_STAFF use the new, deliberately
    narrower `BulkUploadRowLog`-based undo (`_undo_row_log_based`) -- see
    that function's own docstring for why.
    """
    log = _get_bulk_upload_log_or_404(db, bulk_upload_log_id)
    if log.status == BulkUploadStatusEnum.UNDONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This upload has already been undone")

    now = datetime.now(timezone.utc)
    if now > log.undo_deadline:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The 24-hour undo window for this upload has expired"
        )

    log.status = BulkUploadStatusEnum.UNDONE
    log.undone_at = now
    log.undone_by_id = current_user.id

    if log.entity_type == BulkUploadEntityTypeEnum.SANCTIONED_STRENGTH:
        response = _undo_sanctioned_strength(db, log=log, current_user=current_user, request=request)
    else:
        response = _undo_row_log_based(db, log=log, current_user=current_user, request=request)

    db.commit()
    db.refresh(log)

    return response
