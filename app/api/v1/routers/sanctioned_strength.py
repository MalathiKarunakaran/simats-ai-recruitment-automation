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
"""

import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import (
    SANCTIONED_STRENGTH_WRITE_ROLES,
    BulkUploadStatusEnum,
    HousekeepingShiftEnum,
    SanctionedStrengthChangeSourceEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory
from app.models.user import User
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
from app.services import sanctioned_strength_import, storage
from app.services import sanctioned_strength_views
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.reporting import validate_campus_code
from app.services.sanctioned_strength import compute_availability_to_request, working_count_for
from app.services.storage import get_minio_client

router = APIRouter(prefix="/sanctioned-strength", tags=["sanctioned-strength"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as migration.py's tracker-workbook import


def _write_only(current_user: User = Depends(require_roles(*SANCTIONED_STRENGTH_WRITE_ROLES))) -> User:
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
        "effective_from": row.effective_from,
        "remarks": row.remarks,
        "is_active": row.is_active,
    }


def _get_or_404_scoped(db: Session, sanctioned_strength_id: uuid.UUID, scope: CampusScope) -> SanctionedStrength:
    row = db.get(SanctionedStrength, sanctioned_strength_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, row.campus_id)
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

    rows, total, status_counts = sanctioned_strength_views.list_teaching_strength_rows(
        db,
        scope,
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
    return TeachingStrengthListResponse(
        items=rows, total=total, limit=limit, offset=offset, status_counts=status_counts
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

    rows, total, status_counts = sanctioned_strength_views.list_strength_view_rows(
        db,
        scope,
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
    return NonTeachingStrengthListResponse(
        items=rows, total=total, limit=limit, offset=offset, status_counts=status_counts
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
    shift: HousekeepingShiftEnum | None = Query(None),
    search: str | None = Query(None),
    row_status: str | None = Query(None, alias="status"),
    vacancy: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
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

    rows, total, status_counts = sanctioned_strength_views.list_housekeeping_strength_rows(
        db,
        scope,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
        campus_code=validated_campus_code,
        location_id=location_id,
        block=block,
        shift=shift.value if shift is not None else None,
        search=search,
        status=row_status,
        vacancy=vacancy,
    )
    return HousekeepingStrengthListResponse(
        items=rows, total=total, limit=limit, offset=offset, status_counts=status_counts
    )


@router.get("/availability", response_model=SanctionedStrengthAvailabilityRead)
def get_sanctioned_strength_availability(
    campus_id: uuid.UUID = Query(...),
    department_id: uuid.UUID = Query(...),
    designation_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
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

    # Item 6: block designations whose category does not match the
    # department's category.
    if designation.category != department.category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Designation category ({designation.category.value}) does not match "
                f"department category ({department.category.value})."
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
) -> SanctionedStrength:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)
    before = _snapshot(row)
    old_approved_strength = row.approved_strength

    if payload.approved_strength is not None:
        row.approved_strength = payload.approved_strength
    if payload.effective_from is not None:
        row.effective_from = payload.effective_from
    if payload.remarks is not None:
        row.remarks = payload.remarks
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
) -> None:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)

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
) -> PaginatedResponse[SanctionedStrengthHistoryRead]:
    row = _get_or_404_scoped(db, sanctioned_strength_id, scope)

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
    row summarizing the batch and stores the original file bytes in the
    `MINIO_BUCKET_BULK_UPLOADS` bucket.
    """
    data = _read_upload_bytes(file)
    raw_rows = sanctioned_strength_import.parse_rows(data, file.filename)
    validation = sanctioned_strength_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
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
        db.flush()  # assigns log.id, needed for the MinIO key and history FK

        storage_key = storage.upload_bulk_upload_file(
            minio_client,
            bulk_upload_log_id=log.id,
            filename=file.filename or "upload",
            data=data,
            content_type=file.content_type or "application/octet-stream",
        )
        log.stored_file_object_key = storage_key

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

    return BulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
    )


@router.get("/bulk-uploads", response_model=PaginatedResponse[BulkUploadLogRead])
def list_bulk_uploads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_only),
) -> PaginatedResponse[BulkUploadLogRead]:
    """Not campus-scoped -- a single upload batch can span rows across
    multiple campuses, so there is no single `campus_id` to gate on (unlike
    the single-resource SanctionedStrength endpoints above)."""
    query = db.query(BulkUploadLog).order_by(BulkUploadLog.uploaded_at.desc())
    total = query.count()
    items = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


def _get_bulk_upload_log_or_404(db: Session, bulk_upload_log_id: uuid.UUID) -> BulkUploadLog:
    log = db.get(BulkUploadLog, bulk_upload_log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return log


@router.get("/bulk-upload/{bulk_upload_log_id}/error-report")
def download_bulk_upload_error_report(
    bulk_upload_log_id: uuid.UUID,
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(_write_only),
) -> StreamingResponse:
    """Re-downloads the original file from MinIO and re-runs `validate_rows`
    against *current* DB state (rather than caching the original per-row
    rejection reasons anywhere) to rebuild the rejected-row set -- consistent
    with the plan's "no new session/cache infrastructure" choice for this
    feature. This means a reason can theoretically read slightly differently
    if master data changed since the original upload (e.g. a department was
    renamed) -- an accepted, documented edge case, not a bug.
    """
    log = _get_bulk_upload_log_or_404(db, bulk_upload_log_id)
    if log.stored_file_object_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not available")

    data = storage.download_bulk_upload_file_bytes(minio_client, log.stored_file_object_key)
    raw_rows = sanctioned_strength_import.parse_rows(data, log.filename)
    validation = sanctioned_strength_import.validate_rows(db, raw_rows)
    rejected_rows = [row for row in validation.rows if row.status == "rejected"]

    xlsx_bytes = sanctioned_strength_import.build_error_report_xlsx(log, rejected_rows)
    filename = f"sanctioned-strength-bulk-upload-{log.id}-errors.xlsx"
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
    current_user: User = Depends(_write_only),
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


@router.post("/bulk-uploads/{bulk_upload_log_id}/undo", response_model=BulkUploadUndoResponse)
def undo_bulk_upload(
    bulk_upload_log_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_only),
) -> BulkUploadUndoResponse:
    """Reverts every SanctionedStrengthHistory row this batch touched, only
    within the stored 24h `undo_deadline`. For a row this batch *updated*
    (`old_value` is a real prior number), reverting means writing that
    `old_value` back onto the live row. For a row this batch *created*
    (`old_value` is NULL -- there was no prior sanctioned row at all), there
    is no valid number to "write back" (approved_strength is NOT NULL and
    CHECK >= 0) -- undoing a CREATE instead soft-deletes the row it created
    (`is_active=False`), which is the only meaningful way to undo a row's
    entire existence. Each reverted row gets a fresh
    SanctionedStrengthHistory entry (source=MANUAL, since the undo itself is
    a manual admin action, still linked back to this batch's
    bulk_upload_log_id for traceability) -- never a silent mutation.

    Known limitation, not fixed here: if a row was *also* manually edited
    (via PATCH) after this batch's upload but before the undo, this still
    reverts to this batch's own `old_value`, discarding that later manual
    edit -- the 24h window bounds how often this can realistically happen,
    and the plan doesn't ask for finer-grained conflict detection.
    """
    log = _get_bulk_upload_log_or_404(db, bulk_upload_log_id)
    if log.status == BulkUploadStatusEnum.UNDONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This upload has already been undone")

    now = datetime.now(timezone.utc)
    if now > log.undo_deadline:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The 24-hour undo window for this upload has expired"
        )

    history_rows = (
        db.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.bulk_upload_log_id == bulk_upload_log_id)
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

    log.status = BulkUploadStatusEnum.UNDONE
    log.undone_at = now
    log.undone_by_id = current_user.id

    log_event(
        db,
        actor=current_user,
        action="SANCTIONED_STRENGTH_BULK_UPLOAD_UNDONE",
        entity_type="BulkUploadLog",
        entity_id=log.id,
        after_state={"reverted_history_count": reverted},
        request=request,
    )
    db.commit()
    db.refresh(log)

    return BulkUploadUndoResponse(id=log.id, status=log.status, reverted_history_count=reverted)
