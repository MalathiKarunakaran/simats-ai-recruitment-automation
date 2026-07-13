from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_roles
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.migration import MigrationImportResponse
from app.services import migration

router = APIRouter(prefix="/migration", tags=["migration"])

_MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB


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
