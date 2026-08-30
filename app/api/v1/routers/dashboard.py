import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_db, require_permission
from app.models.enums import PermissionEnum
from app.models.user import User
from app.schemas.reporting import DashboardKPIResponse
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
