"""Housekeeping staff roster CRUD (glowing-zooming-hamming.md Phase D) --
structurally the closest template is `app/api/v1/routers/locations.py`
(campus-scoped, soft-delete master-ish data with FKs), same call as this
module's own docstring intent.

Writes are gated to `_WRITE_ROLES` below, not the bare
`SANCTIONED_STRENGTH_WRITE_ROLES` constant -- the Phase D dispatch brief said
to reuse that named constant, but `SANCTIONED_STRENGTH_WRITE_ROLES` itself is
(SUPER_ADMIN, HR_ADMIN) only and predates this epic's plan decision 2 ("HR
Assistant" = RECRUITMENT_OFFICER manages this operational data), which
Phase B's `locations.py` already implements as its own `_WRITE_ROLES =
SUPER_ADMIN, HR_ADMIN, RECRUITMENT_OFFICER`. Corrected post-merge-review to
match that established epic precedent rather than the shared pre-epic
constant literally -- this also makes the campus-scope 404 guard on
PATCH/DELETE actually reachable through a legitimately-authorized caller
(RECRUITMENT_OFFICER is campus-scoped; SUPER_ADMIN/HR_ADMIN are both
GLOBAL_SCOPE_ROLES and couldn't exercise it). The shared
`SANCTIONED_STRENGTH_WRITE_ROLES` constant itself is left untouched -- other
endpoints that already use it directly are out of this phase's scope.

CREATE validates: `designation_id` resolves to a Designation whose category
is HOUSEKEEPING (enforced here, not the DB -- same "validate at the API
layer" choice `sanctioned_strength.py`'s own department/designation category
match already makes), `location_id` resolves to a real Location, and
`(campus_id, bio_id)` isn't already used by another active-or-inactive row
(the DB UniqueConstraint enforces this regardless, but a friendly 409 beats a
raw IntegrityError). DELETE is a soft delete (is_active=False), matching
every other master-data router in this codebase. Every write appends the
standard audit-log entry via log_create/log_update/log_delete.

Phase J (glowing-zooming-hamming.md) adds
`/housekeeping-staff/bulk-upload/*` (template/validate/commit) at the bottom
of this file, mirroring `sanctioned_strength.py`'s own
`/sanctioned-strength/bulk-upload/*` shape exactly (see app/services/
housekeeping_staff_import.py for the validate/commit logic), gated on this
router's own `_WRITE_ROLES` below (the broader, RECRUITMENT_OFFICER-inclusive
set, not the narrower `SANCTIONED_STRENGTH_WRITE_ROLES`). The batch-level
history/error-report/original-file/undo endpoints deliberately stay in
sanctioned_strength.py's already entity-agnostic
`/sanctioned-strength/bulk-uploads*` family (dispatched by
`BulkUploadLog.entity_type`) rather than being duplicated here.
"""

import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.deps import (
    CampusScope,
    campus_scope_note,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_roles,
)
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.designation import Designation
from app.models.enums import (
    SANCTIONED_STRENGTH_WRITE_ROLES,
    BulkUploadEntityTypeEnum,
    BulkUploadStatusEnum,
    HousekeepingShiftEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.location import Location
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.housekeeping_staff import HousekeepingStaffCreate, HousekeepingStaffRead, HousekeepingStaffUpdate
from app.schemas.housekeeping_staff_import import (
    HousekeepingStaffBulkUploadCommitResponse,
    HousekeepingStaffBulkUploadRowPreview,
    HousekeepingStaffBulkUploadValidationResponse,
)
from app.services import exports, housekeeping_staff_import, storage
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/housekeeping-staff", tags=["housekeeping-staff"])

# Same shape as locations.py's own _WRITE_ROLES -- SANCTIONED_STRENGTH_WRITE_ROLES
# plus RECRUITMENT_OFFICER (see module docstring for why).
_WRITE_ROLES = (*SANCTIONED_STRENGTH_WRITE_ROLES, UserRoleEnum.RECRUITMENT_OFFICER)

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as sanctioned_strength.py's own bulk upload


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _snapshot(row: HousekeepingStaff) -> dict:
    return {
        "campus_id": row.campus_id,
        "bio_id": row.bio_id,
        "name": row.name,
        "designation_id": row.designation_id,
        "location_id": row.location_id,
        "block": row.block,
        "floor_venue": row.floor_venue,
        "shift": row.shift.value,
        "supervisor": row.supervisor,
        "is_active": row.is_active,
    }


def _get_or_404_scoped(db: Session, housekeeping_staff_id: uuid.UUID, scope: CampusScope) -> HousekeepingStaff:
    row = db.get(HousekeepingStaff, housekeeping_staff_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, row.campus_id)
    return row


def _validate_housekeeping_designation(db: Session, designation_id: uuid.UUID) -> Designation:
    designation = db.get(Designation, designation_id)
    if designation is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown designation_id")
    if designation.category != StaffRoleCategoryEnum.HOUSEKEEPING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Designation category ({designation.category.value}) is not HOUSEKEEPING -- "
                "Housekeeping staff must be assigned a Housekeeping designation."
            ),
        )
    return designation


@router.get("", response_model=PaginatedResponse[HousekeepingStaffRead])
def list_housekeeping_staff(
    campus_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    block: str | None = Query(None),
    shift: HousekeepingShiftEnum | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[HousekeepingStaffRead]:
    query = db.query(HousekeepingStaff)
    if scope.is_global:
        # Non-global roles are always forced onto their own campus_id below;
        # a global-scope role may optionally narrow to one campus via this
        # query param -- same shape as locations.py's list endpoint.
        if campus_id is not None:
            query = query.filter(HousekeepingStaff.campus_id == campus_id)
    else:
        query = query.filter(HousekeepingStaff.campus_id == scope.campus_id)

    if location_id is not None:
        query = query.filter(HousekeepingStaff.location_id == location_id)
    if block:
        query = query.filter(HousekeepingStaff.block.ilike(f"%{block}%"))
    if shift is not None:
        query = query.filter(HousekeepingStaff.shift == shift)
    if is_active is not None:
        query = query.filter(HousekeepingStaff.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            (HousekeepingStaff.name.ilike(pattern)) | (HousekeepingStaff.bio_id.ilike(pattern))
        )

    total = query.count()
    rows = query.order_by(HousekeepingStaff.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/export")
def export_housekeeping_staff(
    campus_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    block: str | None = Query(None),
    shift: HousekeepingShiftEnum | None = Query(None),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    """Same filters and campus scoping as `list_housekeeping_staff`, minus
    pagination -- exports every matching row, not just one page. xlsx only,
    mirroring departments.py/designations.py/locations.py's own `/export`.

    Deliberately re-applies the filter logic rather than calling the list
    endpoint: that returns one page, and widening its `limit` cap to cover an
    export would weaken a real guard on the paginated endpoint.
    """
    query = db.query(HousekeepingStaff)
    if scope.is_global:
        if campus_id is not None:
            query = query.filter(HousekeepingStaff.campus_id == campus_id)
    else:
        query = query.filter(HousekeepingStaff.campus_id == scope.campus_id)
    if location_id is not None:
        query = query.filter(HousekeepingStaff.location_id == location_id)
    if block:
        query = query.filter(HousekeepingStaff.block.ilike(f"%{block}%"))
    if shift is not None:
        query = query.filter(HousekeepingStaff.shift == shift)
    if is_active is not None:
        query = query.filter(HousekeepingStaff.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.filter((HousekeepingStaff.name.ilike(pattern)) | (HousekeepingStaff.bio_id.ilike(pattern)))

    staff = (
        query.options(
            selectinload(HousekeepingStaff.campus),
            selectinload(HousekeepingStaff.designation),
            selectinload(HousekeepingStaff.location),
        )
        .order_by(HousekeepingStaff.name)
        .all()
    )
    rows = [
        {
            "campus_code": member.campus.code if member.campus else None,
            "bio_id": member.bio_id,
            "name": member.name,
            "designation_name": member.designation.name if member.designation else None,
            "location_name": member.location.name if member.location else None,
            "block": member.block,
            "floor_venue": member.floor_venue,
            "shift": member.shift.value if member.shift else None,
            # `supervisor` is a free-text name on the model, not an FK.
            "supervisor_name": member.supervisor,
            "is_active": member.is_active,
        }
        for member in staff
    ]
    excel_bytes = exports.build_housekeeping_staff_export_excel(
        rows, datetime.now(timezone.utc), campus_scope_note(db, scope, campus_id)
    )
    filename = f"simats-housekeeping-staff-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=HousekeepingStaffRead, status_code=status.HTTP_201_CREATED)
def create_housekeeping_staff(
    payload: HousekeepingStaffCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> HousekeepingStaff:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    _validate_housekeeping_designation(db, payload.designation_id)
    if db.get(Location, payload.location_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")

    existing = (
        db.query(HousekeepingStaff)
        .filter(HousekeepingStaff.campus_id == payload.campus_id, HousekeepingStaff.bio_id == payload.bio_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
        )

    row = HousekeepingStaff(
        campus_id=payload.campus_id,
        bio_id=payload.bio_id,
        name=payload.name,
        designation_id=payload.designation_id,
        location_id=payload.location_id,
        block=payload.block,
        floor_venue=payload.floor_venue,
        shift=payload.shift,
        supervisor=payload.supervisor,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
        )

    log_create(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{housekeeping_staff_id}", response_model=HousekeepingStaffRead)
def update_housekeeping_staff(
    housekeeping_staff_id: uuid.UUID,
    payload: HousekeepingStaffUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> HousekeepingStaff:
    row = _get_or_404_scoped(db, housekeeping_staff_id, scope)
    before = _snapshot(row)

    if payload.designation_id is not None:
        _validate_housekeeping_designation(db, payload.designation_id)
        row.designation_id = payload.designation_id
    if payload.location_id is not None:
        if db.get(Location, payload.location_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location_id")
        row.location_id = payload.location_id
    if payload.bio_id is not None and payload.bio_id != row.bio_id:
        existing = (
            db.query(HousekeepingStaff)
            .filter(
                HousekeepingStaff.campus_id == row.campus_id,
                HousekeepingStaff.bio_id == payload.bio_id,
                HousekeepingStaff.id != row.id,
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"bio_id '{payload.bio_id}' is already in use on this campus.",
            )
        row.bio_id = payload.bio_id
    if payload.name is not None:
        row.name = payload.name
    if payload.block is not None:
        row.block = payload.block
    if payload.floor_venue is not None:
        row.floor_venue = payload.floor_venue
    if payload.shift is not None:
        row.shift = payload.shift
    if payload.supervisor is not None:
        row.supervisor = payload.supervisor
    if payload.is_active is not None:
        row.is_active = payload.is_active
    row.updated_by_id = current_user.id

    log_update(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        after_state=_snapshot(row),
        request=request,
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{housekeeping_staff_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_housekeeping_staff(
    housekeeping_staff_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    row = _get_or_404_scoped(db, housekeeping_staff_id, scope)
    before = _snapshot(row)
    row.is_active = False
    row.updated_by_id = current_user.id

    log_delete(
        db,
        actor=current_user,
        entity_type="HousekeepingStaff",
        entity=row,
        campus_context_id=row.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


# --- Phase J: bulk upload (validate -> preview -> commit) -------------------
#
# Same shape as sanctioned_strength.py's own /bulk-upload/* family -- see
# app/services/housekeeping_staff_import.py for the validate/commit logic.
# The batch-level history/error-report/original-file/undo endpoints
# deliberately stay in sanctioned_strength.py (see this module's own
# docstring).


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: housekeeping_staff_import.ImportRowResult) -> HousekeepingStaffBulkUploadRowPreview:
    return HousekeepingStaffBulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        campus_code=row.campus_code,
        bio_id=row.bio_id,
        name=row.name,
        designation_name=row.designation_name,
        location_name=row.location_name,
        block=row.block,
        floor_venue=row.floor_venue,
        shift=row.shift,
        supervisor=row.supervisor,
    )


@router.get("/bulk-upload/template")
def download_housekeeping_staff_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> StreamingResponse:
    xlsx_bytes = housekeeping_staff_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="housekeeping_staff_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=HousekeepingStaffBulkUploadValidationResponse)
def validate_housekeeping_staff_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> HousekeepingStaffBulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview, same no-server-side-cache contract as
    sanctioned_strength.py's own validate endpoint."""
    data = _read_upload_bytes(file)
    raw_rows = housekeeping_staff_import.parse_rows(data, file.filename)
    validation = housekeeping_staff_import.validate_rows(db, raw_rows)
    return HousekeepingStaffBulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=HousekeepingStaffBulkUploadCommitResponse)
def commit_housekeeping_staff_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> HousekeepingStaffBulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively, then applies every
    non-rejected row's UPSERT in one DB transaction -- same all-or-nothing
    contract as sanctioned_strength.py's own commit endpoint. Writes exactly
    one BulkUploadLog row (entity_type=HOUSEKEEPING_STAFF) plus one
    BulkUploadRowLog row per non-rejected row (see app/services/
    housekeeping_staff_import.py for why).

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring for the full "Could not reach object storage" bug this fixes
    and why): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = housekeeping_staff_import.parse_rows(data, file.filename)
    validation = housekeeping_staff_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.HOUSEKEEPING_STAFF,
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

        housekeeping_staff_import.commit_rows(
            db, validation=validation, actor=current_user, bulk_upload_log_id=log.id
        )

        log_event(
            db,
            actor=current_user,
            action="HOUSEKEEPING_STAFF_BULK_UPLOAD_COMMITTED",
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
            action="HOUSEKEEPING_STAFF_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return HousekeepingStaffBulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )
