import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_permission
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import PermissionEnum
from app.models.user import User
from app.schemas.campus import CampusCreate, CampusRead, CampusUpdate
from app.schemas.common import PaginatedResponse
from app.services.audit import log_create, log_delete, log_update

router = APIRouter(prefix="/campuses", tags=["campuses"])


def _campus_snapshot(campus: Campus) -> dict:
    return {"code": campus.code, "name": campus.name, "is_active": campus.is_active}


@router.get("", response_model=PaginatedResponse[CampusRead])
def list_campuses(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PaginatedResponse[CampusRead]:
    query = db.query(Campus).order_by(Campus.code)
    total = query.count()
    rows = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{campus_id}", response_model=CampusRead)
def get_campus(
    campus_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Campus:
    campus = db.get(Campus, campus_id)
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return campus


@router.post("", response_model=CampusRead, status_code=status.HTTP_201_CREATED)
def create_campus(
    payload: CampusCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_CAMPUSES)),
) -> Campus:
    campus = Campus(code=payload.code, name=payload.name, is_active=payload.is_active)
    db.add(campus)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campus code must be one of the institutional codes and unique",
        )

    log_create(
        db,
        actor=current_user,
        entity_type="Campus",
        entity=campus,
        campus_context_id=campus.id,
        after_state=_campus_snapshot(campus),
        request=request,
    )
    db.commit()
    db.refresh(campus)
    return campus


@router.patch("/{campus_id}", response_model=CampusRead)
def update_campus(
    campus_id: uuid.UUID,
    payload: CampusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_CAMPUSES)),
) -> Campus:
    campus = db.get(Campus, campus_id)
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _campus_snapshot(campus)
    if payload.name is not None:
        campus.name = payload.name
    if payload.is_active is not None:
        campus.is_active = payload.is_active

    log_update(
        db,
        actor=current_user,
        entity_type="Campus",
        entity=campus,
        campus_context_id=campus.id,
        before_state=before,
        after_state=_campus_snapshot(campus),
        request=request,
    )
    db.commit()
    db.refresh(campus)
    return campus


@router.delete("/{campus_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campus(
    campus_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_CAMPUSES)),
) -> None:
    campus = db.get(Campus, campus_id)
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Both Department.campus_id and User.campus_id are ondelete="RESTRICT"
    # FKs (see app/models/department.py, app/models/user.py) -- the two
    # direct, first-class things a campus "owns". A soft delete doesn't hit
    # that FK at all (the row stays put), so this guard exists purely to
    # keep the *business* state sane: a campus still staffed or still
    # organized into active departments shouldn't be markable inactive.
    # Every other campus-scoped table (Application, JobPosting, etc.) is
    # reachable only through a Department/VacancyRequest chain that already
    # bottoms out at one of these two checks, so checking just these two
    # tables is sufficient without walking the whole FK graph.
    active_departments = (
        db.query(Department).filter(Department.campus_id == campus.id, Department.is_active.is_(True)).count()
    )
    if active_departments > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{active_departments} active department(s) reference this campus, cannot delete.",
        )

    active_users = db.query(User).filter(User.campus_id == campus.id, User.is_active.is_(True)).count()
    if active_users > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{active_users} active user(s) reference this campus, cannot delete.",
        )

    before = _campus_snapshot(campus)
    campus.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="Campus",
        entity=campus,
        campus_context_id=campus.id,
        before_state=before,
        request=request,
    )
    db.commit()
