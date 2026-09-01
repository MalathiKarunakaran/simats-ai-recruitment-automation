import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    campus_scope_note,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
)
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.user import User
from app.schemas.sanctioned_strength import DepartmentDesignationBreakdownResponse
from app.schemas.vacancy_register import VacancyRegisterListResponse
from app.services import exports
from app.services import sanctioned_strength as sanctioned_strength_service
from app.services import vacancy_register
from app.services.reporting import validate_campus_code

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Same ceiling the Sanctioned Strength view exports use.
_EXPORT_MAX_ROWS = 50_000

router = APIRouter(prefix="/departments", tags=["departments"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _validate_register_params(
    sort_by: str, sort_dir: str, approval_status: str | None, recruitment_status: str | None
) -> None:
    """Shared by the list endpoint and its export, so the two can never drift
    into accepting different values for the same query param."""
    if sort_by not in vacancy_register.SORT_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown sort_by '{sort_by}'. Valid values: {', '.join(vacancy_register.SORT_FIELDS)}.",
        )
    if sort_dir not in vacancy_register.SORT_DIRECTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown sort_dir '{sort_dir}'. Valid values: {', '.join(vacancy_register.SORT_DIRECTIONS)}.",
        )
    if approval_status is not None and approval_status not in vacancy_register.APPROVAL_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown approval_status '{approval_status}'. "
                f"Valid values: {', '.join(vacancy_register.APPROVAL_STATUS_VALUES)}."
            ),
        )
    if recruitment_status is not None and recruitment_status not in vacancy_register.RECRUITMENT_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown recruitment_status '{recruitment_status}'. "
                f"Valid values: {', '.join(vacancy_register.RECRUITMENT_STATUS_VALUES)}."
            ),
        )


@router.get("/vacancy-register", response_model=VacancyRegisterListResponse)
def list_vacancy_register(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("department_name"),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    approval_status: str | None = Query(None),
    recruitment_status: str | None = Query(None),
    is_active: bool | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRegisterListResponse:
    _validate_register_params(sort_by, sort_dir, approval_status, recruitment_status)
    validated_campus_code = validate_campus_code(campus_code)

    rows, total, category_counts = vacancy_register.list_vacancy_register_rows(
        db,
        scope,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
        campus_code=validated_campus_code,
        category=category,
        department_id=department_id,
        search=search,
        approval_status=approval_status,
        recruitment_status=recruitment_status,
        is_active=is_active,
    )
    return VacancyRegisterListResponse(
        items=rows, total=total, limit=limit, offset=offset, category_counts=category_counts
    )


@router.get("/vacancy-register/export")
def export_vacancy_register(
    sort_by: str = Query("department_name"),
    sort_dir: str = Query("asc"),
    campus_code: str | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    approval_status: str | None = Query(None),
    recruitment_status: str | None = Query(None),
    is_active: bool | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    """xlsx export of the Sanctioned Strength "All" tab, minus pagination.

    Completes the master-data export parity finished for the other five
    screens on 2026-08-27 (`c64cf8a`); the All tab was the one deliberate gap
    left, because it is department-grained rather than sharing either of the
    three views' row shapes.

    Registered ahead of `/{department_id}/sanctioned-strength-breakdown`
    below: both are two-segment paths under this prefix, and FastAPI matches
    in registration order, so the literal has to come first or
    "vacancy-register" would be swallowed as a `department_id` and 422 on the
    UUID parse.

    Gated on `_staff_only`, exactly like the list it mirrors -- an export must
    never widen or narrow what the caller can already read on screen.
    """
    _validate_register_params(sort_by, sort_dir, approval_status, recruitment_status)
    validated_campus_code = validate_campus_code(campus_code)

    rows, _total, _counts = vacancy_register.list_vacancy_register_rows(
        db,
        scope,
        limit=_EXPORT_MAX_ROWS,
        offset=0,
        sort_by=sort_by,
        sort_dir=sort_dir,
        campus_code=validated_campus_code,
        category=category,
        department_id=department_id,
        search=search,
        approval_status=approval_status,
        recruitment_status=recruitment_status,
        is_active=is_active,
    )

    # campus_code, not campus_id, is this family's narrowing param -- resolve
    # it so the workbook's Scope line reads like every other export's.
    scope_campus_id = None
    if validated_campus_code:
        campus_row = db.query(Campus).filter(Campus.code == validated_campus_code).one_or_none()
        scope_campus_id = campus_row.id if campus_row else None

    generated_at = datetime.now(timezone.utc)
    excel_bytes = exports.build_vacancy_register_export_excel(
        rows,  # list_vacancy_register_rows already yields plain dicts
        generated_at,
        campus_scope_note(db, scope, scope_campus_id),
    )
    filename = f"simats-sanctioned-strength-all-{generated_at:%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/{department_id}/sanctioned-strength-breakdown",
    response_model=DepartmentDesignationBreakdownResponse,
)
def get_department_sanctioned_strength_breakdown(
    department_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> DepartmentDesignationBreakdownResponse:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, department.campus_id)

    rows = sanctioned_strength_service.list_department_designation_breakdown(db, department_id)
    return DepartmentDesignationBreakdownResponse(items=rows)
