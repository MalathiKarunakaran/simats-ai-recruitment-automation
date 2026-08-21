import io
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_db, require_permission
from app.models.enums import PermissionEnum
from app.models.user import User
from app.schemas.reporting import ADBriefingResponse, ReportResponse, WeeklyRecruitmentStatusResponse
from app.services import exports, reporting

router = APIRouter(prefix="/reports", tags=["reports"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


# Every real non-CANDIDATE role's Phase 1 default permission set already
# includes REPORTS, so this is a zero-regression tightening over the old
# CANDIDATE-only-blocking _staff_only gate -- it also closes a real gap where
# a CANDIDATE-role session could technically hit these endpoints (a
# CANDIDATE never gets any permission grants -- seed_default_permissions
# skips them -- so require_permission(REPORTS) blocks them too, same
# end result as the old gate, just via the permission matrix now).
def _staff_only(current_user: User = Depends(require_permission(PermissionEnum.REPORTS))) -> User:
    return current_user


def _build_report(
    report_type: str,
    db: Session,
    scope: CampusScope,
    campus_code: str | None,
    role_category: str | None,
    start_date: date | None,
    end_date: date | None,
) -> dict:
    builder = reporting.REPORT_BUILDERS.get(report_type)
    if builder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown report_type '{report_type}'. Valid values: {', '.join(reporting.REPORT_BUILDERS)}.",
        )
    validated_campus_code = reporting.validate_campus_code(campus_code)
    validated_role_category = reporting.validate_role_category(role_category)
    reporting.validate_date_range(start_date, end_date)
    return builder(
        db,
        scope,
        campus_code=validated_campus_code,
        role_category=validated_role_category,
        start_date=start_date,
        end_date=end_date,
    )


# NOTE: these two /ad-briefing routes must stay registered before the
# generic /{report_type} routes below, otherwise Starlette would match
# "ad-briefing" as a report_type path param instead.
@router.get("/ad-briefing", response_model=ADBriefingResponse)
def get_ad_briefing(
    campus_code: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ADBriefingResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    reporting.validate_date_range(start_date, end_date)
    summary = reporting.build_ad_briefing_summary(
        db, scope, campus_code=validated_campus_code, start_date=start_date, end_date=end_date
    )
    return ADBriefingResponse(**summary)


@router.get("/ad-briefing/export")
def export_ad_briefing(
    campus_code: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    reporting.validate_date_range(start_date, end_date)
    summary = reporting.build_ad_briefing_summary(
        db, scope, campus_code=validated_campus_code, start_date=start_date, end_date=end_date
    )
    pptx_bytes = exports.build_ad_briefing_pptx(summary)
    filename = f"simats-ad-briefing-{datetime.now(timezone.utc):%Y%m%d}.pptx"
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type=_PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# NOTE: these two /weekly-status routes must stay registered before the
# generic /{report_type} routes below, for the same reason as /ad-briefing
# above.
@router.get("/weekly-status", response_model=WeeklyRecruitmentStatusResponse)
def get_weekly_recruitment_status(
    start_date: date = Query(...),
    end_date: date = Query(...),
    campus_code: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> WeeklyRecruitmentStatusResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    reporting.validate_date_range(start_date, end_date)
    summary = reporting.build_weekly_recruitment_status(
        db, scope, start_date=start_date, end_date=end_date, campus_code=validated_campus_code
    )
    return WeeklyRecruitmentStatusResponse(**summary)


@router.get("/weekly-status/export")
def export_weekly_recruitment_status(
    start_date: date = Query(...),
    end_date: date = Query(...),
    campus_code: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    reporting.validate_date_range(start_date, end_date)
    summary = reporting.build_weekly_recruitment_status(
        db, scope, start_date=start_date, end_date=end_date, campus_code=validated_campus_code
    )
    pptx_bytes = exports.build_weekly_status_pptx(summary)
    filename = f"simats-weekly-status-{start_date:%Y%m%d}-{end_date:%Y%m%d}.pptx"
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type=_PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{report_type}", response_model=ReportResponse)
def get_report(
    report_type: str,
    campus_code: str | None = Query(None),
    role_category: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ReportResponse:
    report = _build_report(report_type, db, scope, campus_code, role_category, start_date, end_date)
    return ReportResponse(**report)


@router.get("/{report_type}/export")
def export_report(
    report_type: str,
    campus_code: str | None = Query(None),
    role_category: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    format: Literal["xlsx"] = Query("xlsx"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    report = _build_report(report_type, db, scope, campus_code, role_category, start_date, end_date)
    excel_bytes = exports.build_report_excel(
        report_type, report["rows"], report["generated_at"], report["scope_note"]
    )
    filename = f"simats-{report_type}-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
