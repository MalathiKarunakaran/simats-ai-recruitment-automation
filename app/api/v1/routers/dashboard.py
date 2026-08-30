import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_db, require_permission
from app.models.enums import PermissionEnum
from app.models.user import User
from app.schemas.reporting import DashboardKPIResponse, DashboardStrengthTableResponse
from app.services import reporting

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# Every real non-CANDIDATE role's Phase 1 default permission set already
# includes SETTINGS -- see reports.py's identical rationale, mirrored here.
def _staff_only(current_user: User = Depends(require_permission(PermissionEnum.SETTINGS))) -> User:
    return current_user


@router.get("/kpis", response_model=DashboardKPIResponse)
def get_dashboard_kpis(
    campus_code: str | None = Query(None),
    role_category: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    # Drill-down filters (2026-08-30). All optional and all default to None,
    # so an existing caller passing none of them gets byte-for-byte the same
    # response as before. Typed as UUID so a malformed id is a 422 here
    # rather than a silent no-match deeper in the service.
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> DashboardKPIResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    validated_role_category = reporting.validate_role_category(role_category)
    reporting.validate_date_range(start_date, end_date)
    kpis = reporting.get_dashboard_kpis(
        db,
        scope,
        campus_code=validated_campus_code,
        role_category=validated_role_category,
        start_date=start_date,
        end_date=end_date,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
    )
    return DashboardKPIResponse(**kpis)


@router.get("/strength-table", response_model=DashboardStrengthTableResponse)
def get_dashboard_strength_table(
    campus_code: str | None = Query(None),
    role_category: str | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    designation_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    # The dashboard's Recruitment Status filter. Deliberately scoped to this
    # TABLE only and not to /kpis: filtering the KPI tiles by status would
    # make "Vacancies" self-referential (a vacancy total computed only from
    # rows that already have vacancies), which is a number nobody can reason
    # about.
    recruitment_status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> DashboardStrengthTableResponse:
    """Main dashboard table -- same RBAC and campus scoping as /kpis above
    (`_staff_only` + `get_campus_scope`), no new permission surface."""
    validated_campus_code = reporting.validate_campus_code(campus_code)
    validated_role_category = reporting.validate_role_category(role_category)
    items, total = reporting.dashboard_strength_table_rows(
        db,
        scope,
        campus_code=validated_campus_code,
        role_category=validated_role_category,
        department_id=department_id,
        designation_id=designation_id,
        location_id=location_id,
        recruitment_status=recruitment_status,
        limit=limit,
        offset=offset,
    )
    return DashboardStrengthTableResponse(items=items, total=total, limit=limit, offset=offset)
