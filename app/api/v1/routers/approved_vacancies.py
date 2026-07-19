import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db
from app.models.approved_vacancy import ApprovedVacancy
from app.models.enums import UserRoleEnum
from app.models.hiring_slot import HiringSlot
from app.models.user import User
from app.schemas.approved_vacancy import ApprovedVacancyRead
from app.schemas.common import PaginatedResponse
from app.schemas.hiring_slot import HiringSlotRead

router = APIRouter(prefix="/approved-vacancies", tags=["approved-vacancies"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_or_404_scoped(db: Session, approved_vacancy_id: uuid.UUID, scope: CampusScope) -> ApprovedVacancy:
    av = db.get(ApprovedVacancy, approved_vacancy_id)
    if av is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, av.campus_id)
    return av


@router.get("", response_model=PaginatedResponse[ApprovedVacancyRead])
def list_approved_vacancies(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    vacancy_request_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[ApprovedVacancyRead]:
    query = db.query(ApprovedVacancy)
    if not scope.is_global:
        query = query.filter(ApprovedVacancy.campus_id == scope.campus_id)
    if vacancy_request_id is not None:
        query = query.filter(ApprovedVacancy.vacancy_request_id == vacancy_request_id)
    total = query.count()
    rows = query.order_by(ApprovedVacancy.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{approved_vacancy_id}", response_model=ApprovedVacancyRead)
def get_approved_vacancy(
    approved_vacancy_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ApprovedVacancy:
    return _get_or_404_scoped(db, approved_vacancy_id, scope)


@router.get("/{approved_vacancy_id}/hiring-slots", response_model=PaginatedResponse[HiringSlotRead])
def list_hiring_slots(
    approved_vacancy_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[HiringSlotRead]:
    _get_or_404_scoped(db, approved_vacancy_id, scope)
    query = db.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == approved_vacancy_id)
    total = query.count()
    rows = query.order_by(HiringSlot.slot_number).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


hiring_slots_router = APIRouter(prefix="/hiring-slots", tags=["hiring-slots"])


@hiring_slots_router.get("/{slot_id}", response_model=HiringSlotRead)
def get_hiring_slot(
    slot_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> HiringSlot:
    slot = db.get(HiringSlot, slot_id)
    if slot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, slot.approved_vacancy.campus_id)
    return slot
