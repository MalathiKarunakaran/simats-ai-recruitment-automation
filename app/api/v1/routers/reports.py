import io
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, get_campus_scope, get_current_active_user, get_db
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.reporting import ADBriefingResponse, ReportResponse
from app.services import exports, reporting

router = APIRouter(prefix="/reports", tags=["reports"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _build_report(
    report_type: str, db: Session, scope: CampusScope, campus_code: str | None, role_category: str | None
) -> dict:
    builder = reporting.REPORT_BUILDERS.get(report_type)
    if builder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown report_type '{report_type}'. Valid values: {', '.join(reporting.REPORT_BUILDERS)}.",
        )
    validated_campus_code = reporting.validate_campus_code(campus_code)
    validated_role_category = reporting.validate_role_category(role_category)
    return builder(db, scope, campus_code=validated_campus_code, role_category=validated_role_category)


# NOTE: these two /ad-briefing routes must stay registered before the
# generic /{report_type} routes below, otherwise Starlette would match
# "ad-briefing" as a report_type path param instead.
@router.get("/ad-briefing", response_model=ADBriefingResponse)
def get_ad_briefing(
    campus_code: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ADBriefingResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    summary = reporting.build_ad_briefing_summary(db, scope, campus_code=validated_campus_code)
    return ADBriefingResponse(**summary)


@router.get("/ad-briefing/export")
def export_ad_briefing(
    campus_code: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    validated_campus_code = reporting.validate_campus_code(campus_code)
    summary = reporting.build_ad_briefing_summary(db, scope, campus_code=validated_campus_code)
    pptx_bytes = exports.build_ad_briefing_pptx(summary)
    filename = f"simats-ad-briefing-{datetime.now(timezone.utc):%Y%m%d}.pptx"
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
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ReportResponse:
    report = _build_report(report_type, db, scope, campus_code, role_category)
    return ReportResponse(**report)


@router.get("/{report_type}/export")
def export_report(
    report_type: str,
    campus_code: str | None = Query(None),
    role_category: str | None = Query(None),
    format: Literal["xlsx"] = Query("xlsx"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> StreamingResponse:
    report = _build_report(report_type, db, scope, campus_code, role_category)
    excel_bytes = exports.build_report_excel(
        report_type, report["rows"], report["generated_at"], report["scope_note"]
    )
    filename = f"simats-{report_type}-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
