"""Location Master (glowing-zooming-hamming.md Phase B), extended in Phase C
with a DELETE dependency guard once `SanctionedStrength.location_id` exists.
DELETE below is blocked (409) while any active SanctionedStrength row still
references this location, mirroring `sanctioned_strength.py`'s own
`working_count_for()`-based delete guard and `departments.py`'s delete-guard
message style.

Structurally the closest template is `app/api/v1/routers/departments.py`
(campus-scoped, category-carrying, soft-delete master data), with one
deliberate RBAC deviation: write access here also includes
RECRUITMENT_OFFICER, mapping the original spec's "HR Assistant" role onto
this codebase's existing RECRUITMENT_OFFICER role (plan decision 4) -- a
broader write set than Department's own `_WRITE_ROLES`.

Phase J (glowing-zooming-hamming.md) adds `/locations/bulk-upload/*`
(template/validate/commit) at the bottom of this file, mirroring
`sanctioned_strength.py`'s own `/sanctioned-strength/bulk-upload/*` shape
exactly (see app/services/location_import.py for the validate/commit logic),
gated on this router's own `_WRITE_ROLES` (not the narrower, Sanctioned-
Strength-specific `SANCTIONED_STRENGTH_WRITE_ROLES`). The batch-level
history/error-report/original-file/undo endpoints are NOT duplicated here --
they stay in sanctioned_strength.py's already entity-agnostic
`/sanctioned-strength/bulk-uploads*` family (dispatched by
`BulkUploadLog.entity_type`), a deliberate, if slightly awkward-sounding,
naming compromise in favor of genuine code reuse.
"""

import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_permission,
)
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.enums import BulkUploadEntityTypeEnum, BulkUploadStatusEnum, PermissionEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.location import LocationCreate, LocationRead, LocationUpdate
from app.schemas.location_import import (
    LocationBulkUploadCommitResponse,
    LocationBulkUploadRowPreview,
    LocationBulkUploadValidationResponse,
)
from app.services import location_import, storage
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/locations", tags=["locations"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as sanctioned_strength.py's own bulk upload

# Same shape as departments.py's _WRITE_ROLES, plus RECRUITMENT_OFFICER --
# a deliberate, plan-confirmed deviation (glowing-zooming-hamming.md decision
# 4): the spec's "HR Assistant" role maps onto RECRUITMENT_OFFICER, which
# gets direct write/deactivate access here (unlike Department/Designation).
_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_OFFICER)


def _location_snapshot(location: Location) -> dict:
    return {
        "campus_id": location.campus_id,
        "name": location.name,
        "block_building": location.block_building,
        "floor_venue": location.floor_venue,
        "category": location.category.value if location.category else None,
        "is_active": location.is_active,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_or_404_scoped(db: Session, location_id: uuid.UUID, scope: CampusScope) -> Location:
    location = db.get(Location, location_id)
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, location.campus_id)
    return location


@router.get("", response_model=PaginatedResponse[LocationRead])
def list_locations(
    campus_id: uuid.UUID | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    search: str | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[LocationRead]:
    query = db.query(Location)
    if scope.is_global:
        # Non-global roles are always forced onto their own campus_id below;
        # a global-scope role may optionally narrow to one campus via this
        # query param.
        if campus_id is not None:
            query = query.filter(Location.campus_id == campus_id)
    else:
        query = query.filter(Location.campus_id == scope.campus_id)

    if category is not None:
        query = query.filter(Location.category == category)
    if search:
        query = query.filter(Location.name.ilike(f"%{search}%"))
    if not include_inactive:
        query = query.filter(Location.is_active.is_(True))

    total = query.count()
    rows = query.order_by(Location.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=LocationRead, status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
) -> Location:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    location = Location(
        campus_id=payload.campus_id,
        name=payload.name,
        block_building=payload.block_building,
        floor_venue=payload.floor_venue,
        category=payload.category,
        is_active=payload.is_active,
    )
    db.add(location)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        after_state=_location_snapshot(location),
        request=request,
    )
    db.commit()
    db.refresh(location)
    return location


@router.patch("/{location_id}", response_model=LocationRead)
def update_location(
    location_id: uuid.UUID,
    payload: LocationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> Location:
    location = _get_or_404_scoped(db, location_id, scope)

    before = _location_snapshot(location)
    if payload.name is not None:
        location.name = payload.name
    if payload.block_building is not None:
        location.block_building = payload.block_building
    if payload.floor_venue is not None:
        location.floor_venue = payload.floor_venue
    if payload.category is not None:
        location.category = payload.category
    if payload.is_active is not None:
        location.is_active = payload.is_active

    log_update(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        before_state=before,
        after_state=_location_snapshot(location),
        request=request,
    )
    db.commit()
    db.refresh(location)
    return location


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    # Phase C (glowing-zooming-hamming.md) dependency guard -- now that
    # SanctionedStrength.location_id exists, block the soft delete while any
    # active SanctionedStrength row still references this location, mirroring
    # departments.py's own delete-guard style (count + 409 message).
    location = _get_or_404_scoped(db, location_id, scope)

    active_sanctioned_strength = (
        db.query(SanctionedStrength)
        .filter(SanctionedStrength.location_id == location.id, SanctionedStrength.is_active.is_(True))
        .count()
    )
    if active_sanctioned_strength > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{active_sanctioned_strength} active sanctioned-strength record(s) reference this "
                "location, cannot delete."
            ),
        )

    before = _location_snapshot(location)
    location.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="Location",
        entity=location,
        campus_context_id=location.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


# --- Phase J: bulk upload (validate -> preview -> commit) -------------------
#
# Same shape as sanctioned_strength.py's own /bulk-upload/* family -- see
# app/services/location_import.py for the validate/commit logic. The
# batch-level history/error-report/original-file/undo endpoints deliberately
# stay in sanctioned_strength.py (see this module's own docstring).


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: location_import.ImportRowResult) -> LocationBulkUploadRowPreview:
    return LocationBulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        campus_code=row.campus_code,
        location_name=row.location_name,
        block_building=row.block_building,
        floor_venue=row.floor_venue,
        category=row.category,
    )


@router.get("/bulk-upload/template")
def download_location_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
) -> StreamingResponse:
    xlsx_bytes = location_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="location_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=LocationBulkUploadValidationResponse)
def validate_location_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
) -> LocationBulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview, same no-server-side-cache contract as
    sanctioned_strength.py's own validate endpoint."""
    data = _read_upload_bytes(file)
    raw_rows = location_import.parse_rows(data, file.filename)
    validation = location_import.validate_rows(db, raw_rows)
    return LocationBulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=LocationBulkUploadCommitResponse)
def commit_location_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_LOCATIONS)),
) -> LocationBulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively, then applies every
    non-rejected row's UPSERT in one DB transaction -- same all-or-nothing
    contract as sanctioned_strength.py's own commit endpoint. Writes exactly
    one BulkUploadLog row (entity_type=LOCATION) plus one BulkUploadRowLog
    row per non-rejected row (see app/services/location_import.py for why).

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring for the full "Could not reach object storage" bug this fixes
    and why): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = location_import.parse_rows(data, file.filename)
    validation = location_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.LOCATION,
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

        location_import.commit_rows(db, validation=validation, bulk_upload_log_id=log.id)

        log_event(
            db,
            actor=current_user,
            action="LOCATION_BULK_UPLOAD_COMMITTED",
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
        # Recorded for ops visibility into *why* archival failed (this
        # backend has no structured logging yet -- the audit log is the one
        # durable place a failure reason like this can be traced later).
        # Deliberately its own separate event, not folded into the
        # already-committed LOCATION_BULK_UPLOAD_COMMITTED entry above.
        log_event(
            db,
            actor=current_user,
            action="LOCATION_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return LocationBulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )
