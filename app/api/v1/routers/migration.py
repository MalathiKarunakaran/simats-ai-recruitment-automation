from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_roles
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.migration import MigrationImportResponse
from app.schemas.tracker_import import TrackerImportResponse
from app.services import migration, tracker_import

router = APIRouter(prefix="/migration", tags=["migration"])

_MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB
_MAX_XLSX_BYTES = 10 * 1024 * 1024  # 10 MB
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# app/api/v1/routers/migration.py -> repo root
_TRACKER_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[4] / "data" / "SIMATS_Recruitment_Tracker_TEMPLATE.xlsx"
)


@router.post("/import-legacy-vacancies", response_model=MigrationImportResponse)
def import_legacy_vacancies(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)),
) -> dict:
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .csv files are accepted")

    data = file.file.read()
    if len(data) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file exceeds the 5 MB limit")

    result = migration.import_legacy_vacancies(db, csv_bytes=data, actor=current_user, request=request)
    db.commit()
    return result


@router.get("/tracker-template")
def download_tracker_template(
    current_user: User = Depends(require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)),
) -> FileResponse:
    """Serves the real generated template (scripts/generate_tracker_template.py)
    -- not a client-side-regenerated stub -- so the Master Lists sheet and
    its Excel data-validation dropdowns actually make it to the user."""
    if not _TRACKER_TEMPLATE_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found on the server -- run scripts/generate_tracker_template.py",
        )
    return FileResponse(
        _TRACKER_TEMPLATE_PATH,
        media_type=_XLSX_MEDIA_TYPE,
        filename="SIMATS_Recruitment_Tracker_TEMPLATE.xlsx",
    )


@router.post("/import-tracker-workbook", response_model=TrackerImportResponse)
def import_tracker_workbook(
    request: Request,
    file: UploadFile = File(...),
    include_sample: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)),
) -> dict:
    """Imports the real, currently-manual SIMATS recruitment tracker
    workbook (see scripts/generate_tracker_template.py for the template this
    expects) as live data -- Vacancy Tracker rows land as already-published
    vacancies with real hiring slots, not DRAFT placeholders like
    /import-legacy-vacancies above. Safe to re-run: rows are matched by the
    workbook's own Request ID / Candidate ID and updated in place."""
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx files are accepted")

    data = file.file.read()
    if len(data) > _MAX_XLSX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workbook exceeds the 10 MB limit")

    result = tracker_import.import_tracker_workbook(
        db, workbook_bytes=data, actor=current_user, request=request, include_sample=include_sample
    )
    db.commit()
    return result
