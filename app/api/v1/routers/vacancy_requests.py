import uuid
from datetime import datetime, timezone

import openai
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_roles,
)
from app.models.approved_vacancy import ApprovedVacancy
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import UserRoleEnum, VacancyRequestStatusEnum
from app.models.job_posting import JobPosting
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.schemas.approved_vacancy import ApprovedVacancyRead
from app.schemas.common import PaginatedResponse
from app.schemas.job_posting import JobPostingRead
from app.schemas.vacancy_request import (
    VacancyRequestCancelRequest,
    VacancyRequestCreate,
    VacancyRequestGenerateJDRequest,
    VacancyRequestRead,
    VacancyRequestRejectRequest,
    VacancyRequestUpdate,
    VacancySlotCountUpdateRequest,
)
from app.services import jd_generation, vacancy_workflow
from app.services.ai_client import get_openai_client
from app.services.audit import log_create, log_delete, log_update

router = APIRouter(prefix="/vacancy-requests", tags=["vacancy-requests"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _can_write(
    current_user: User = Depends(require_roles(UserRoleEnum.CAMPUS_HOD, UserRoleEnum.SUPER_ADMIN)),
) -> User:
    return current_user


def _snapshot(vr: VacancyRequest) -> dict:
    return {
        "position_title": vr.position_title,
        "employment_type": vr.employment_type.value,
        "requested_count": vr.requested_count,
        "qualification": vr.qualification,
        "experience_required": vr.experience_required,
        "salary_band_min": vr.salary_band_min,
        "salary_band_max": vr.salary_band_max,
        "jd_draft": vr.jd_draft,
        "skills": vr.skills,
        "priority": vr.priority.value,
        "status": vr.status.value,
    }


def _get_or_404_scoped(db: Session, vacancy_request_id: uuid.UUID, scope: CampusScope) -> VacancyRequest:
    vr = db.get(VacancyRequest, vacancy_request_id)
    if vr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, vr.campus_id)
    return vr


@router.post("", response_model=VacancyRequestRead, status_code=status.HTTP_201_CREATED)
def create_vacancy_request(
    payload: VacancyRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_can_write),
) -> VacancyRequest:
    if current_user.role == UserRoleEnum.CAMPUS_HOD and payload.campus_id != current_user.campus_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Campus HODs may only raise vacancy requests for their own campus",
        )
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    department = db.get(Department, payload.department_id)
    if department is None or department.campus_id != payload.campus_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="department_id must belong to campus_id"
        )

    vr = VacancyRequest(
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        role_category=payload.role_category,
        position_title=payload.position_title,
        employment_type=payload.employment_type,
        requested_count=payload.requested_count,
        qualification=payload.qualification,
        experience_required=payload.experience_required,
        salary_band_min=payload.salary_band_min,
        salary_band_max=payload.salary_band_max,
        jd_draft=payload.jd_draft,
        skills=payload.skills,
        priority=payload.priority,
        requested_by_id=current_user.id,
    )
    db.add(vr)
    db.flush()
    log_create(
        db,
        actor=current_user,
        entity_type="VacancyRequest",
        entity=vr,
        campus_context_id=vr.campus_id,
        after_state=_snapshot(vr),
        request=request,
    )
    db.commit()
    db.refresh(vr)
    return vr


@router.get("", response_model=PaginatedResponse[VacancyRequestRead])
def list_vacancy_requests(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status_filter: VacancyRequestStatusEnum | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[VacancyRequestRead]:
    query = db.query(VacancyRequest)
    if not scope.is_global:
        query = query.filter(VacancyRequest.campus_id == scope.campus_id)
    if status_filter is not None:
        query = query.filter(VacancyRequest.status == status_filter)
    total = query.count()
    rows = query.order_by(VacancyRequest.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/{vacancy_request_id}", response_model=VacancyRequestRead)
def get_vacancy_request(
    vacancy_request_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    return _get_or_404_scoped(db, vacancy_request_id, scope)


@router.patch("/{vacancy_request_id}", response_model=VacancyRequestRead)
def update_vacancy_request(
    vacancy_request_id: uuid.UUID,
    payload: VacancyRequestUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_can_write),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    if vr.status != VacancyRequestStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only DRAFT vacancy requests can be edited"
        )

    before = _snapshot(vr)
    for field in (
        "position_title",
        "employment_type",
        "requested_count",
        "qualification",
        "experience_required",
        "salary_band_min",
        "salary_band_max",
        "jd_draft",
        "skills",
        "priority",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(vr, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="VacancyRequest",
        entity=vr,
        campus_context_id=vr.campus_id,
        before_state=before,
        after_state=_snapshot(vr),
        request=request,
    )
    db.commit()
    db.refresh(vr)
    return vr


@router.post("/{vacancy_request_id}/generate-jd", response_model=VacancyRequestRead)
def generate_jd_for_vacancy_request(
    vacancy_request_id: uuid.UUID,
    payload: VacancyRequestGenerateJDRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_can_write),
    scope: CampusScope = Depends(get_campus_scope),
    ai: openai.OpenAI = Depends(get_openai_client),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    if vr.status != VacancyRequestStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only DRAFT vacancy requests can have a JD generated"
        )

    jd_generation.generate_and_apply_jd(
        db,
        vacancy_request=vr,
        client=ai,
        additional_instructions=payload.additional_instructions,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(vr)
    return vr


@router.delete("/{vacancy_request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_can_write),
    scope: CampusScope = Depends(get_campus_scope),
) -> None:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    if vr.status != VacancyRequestStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Only DRAFT vacancy requests can be deleted"
        )

    before = _snapshot(vr)
    log_delete(
        db,
        actor=current_user,
        entity_type="VacancyRequest",
        entity=vr,
        campus_context_id=vr.campus_id,
        before_state=before,
        request=request,
    )
    db.delete(vr)
    db.commit()


@router.post("/{vacancy_request_id}/submit", response_model=VacancyRequestRead)
def submit_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_can_write),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    vacancy_workflow.submit(db, vr, current_user, request)
    db.commit()
    db.refresh(vr)
    return vr


@router.post("/{vacancy_request_id}/dean-approve", response_model=VacancyRequestRead)
def dean_approve_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT, UserRoleEnum.SUPER_ADMIN)),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    vacancy_workflow.dean_approve(db, vr, current_user, request)
    db.commit()
    db.refresh(vr)
    return vr


@router.post("/{vacancy_request_id}/reject", response_model=VacancyRequestRead)
def reject_vacancy_request(
    vacancy_request_id: uuid.UUID,
    payload: VacancyRequestRejectRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
            UserRoleEnum.HR_ADMIN,
            UserRoleEnum.SUPER_ADMIN,
            UserRoleEnum.RECRUITMENT_COORDINATOR,
        )
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    vacancy_workflow.reject(db, vr, current_user, payload.reason, request)
    db.commit()
    db.refresh(vr)
    return vr


@router.post("/{vacancy_request_id}/hr-approve", response_model=ApprovedVacancyRead)
def hr_approve_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> ApprovedVacancy:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    approved_vacancy = vacancy_workflow.hr_approve(db, vr, current_user, request)
    db.commit()
    db.refresh(approved_vacancy)
    return approved_vacancy


@router.post("/{vacancy_request_id}/publish", response_model=JobPostingRead)
def publish_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRoleEnum.HR_ADMIN,
            UserRoleEnum.RECRUITMENT_OFFICER,
            UserRoleEnum.SUPER_ADMIN,
            UserRoleEnum.RECRUITMENT_COORDINATOR,
        )
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> JobPosting:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    approved_vacancy = (
        db.query(ApprovedVacancy).filter(ApprovedVacancy.vacancy_request_id == vr.id).one_or_none()
    )
    if approved_vacancy is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vacancy request has not been approved")

    job_posting = vacancy_workflow.publish(db, vr, approved_vacancy, current_user, request)
    db.commit()
    db.refresh(job_posting)
    return job_posting


@router.post("/{vacancy_request_id}/close", response_model=VacancyRequestRead)
def close_vacancy_request(
    vacancy_request_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    approved_vacancy = (
        db.query(ApprovedVacancy).filter(ApprovedVacancy.vacancy_request_id == vr.id).one_or_none()
    )
    job_posting = None
    if approved_vacancy is not None:
        job_posting = (
            db.query(JobPosting).filter(JobPosting.approved_vacancy_id == approved_vacancy.id).one_or_none()
        )

    vacancy_workflow.close(db, vr, approved_vacancy, job_posting, current_user, request)
    db.commit()
    db.refresh(vr)
    return vr


@router.post("/{vacancy_request_id}/cancel", response_model=VacancyRequestRead)
def cancel_vacancy_request(
    vacancy_request_id: uuid.UUID,
    payload: VacancyRequestCancelRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> VacancyRequest:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    approved_vacancy = (
        db.query(ApprovedVacancy).filter(ApprovedVacancy.vacancy_request_id == vr.id).one_or_none()
    )
    job_posting = None
    if approved_vacancy is not None:
        job_posting = (
            db.query(JobPosting).filter(JobPosting.approved_vacancy_id == approved_vacancy.id).one_or_none()
        )

    vacancy_workflow.cancel(db, vr, approved_vacancy, job_posting, current_user, payload.reason, request)
    db.commit()
    db.refresh(vr)
    return vr


@router.patch("/{vacancy_request_id}/slot-count", response_model=ApprovedVacancyRead)
def adjust_vacancy_request_slot_count(
    vacancy_request_id: uuid.UUID,
    payload: VacancySlotCountUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
    ),
    scope: CampusScope = Depends(get_campus_scope),
) -> ApprovedVacancy:
    vr = _get_or_404_scoped(db, vacancy_request_id, scope)
    approved_vacancy = (
        db.query(ApprovedVacancy).filter(ApprovedVacancy.vacancy_request_id == vr.id).one_or_none()
    )
    if approved_vacancy is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vacancy request has not been approved")

    approved_vacancy = vacancy_workflow.adjust_slot_count(
        db, vr, approved_vacancy, payload.requested_count, current_user, request
    )
    db.commit()
    db.refresh(approved_vacancy)
    return approved_vacancy
