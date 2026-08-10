import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.pipeline_stage_config import PipelineStageConfig
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.pipeline_stage_config import (
    PipelineStageConfigCreate,
    PipelineStageConfigRead,
    PipelineStageConfigUpdate,
)
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/pipeline-stage-configs", tags=["pipeline-stage-configs"])

# Same admin-editable-reference-table write gate as Eligibility Rules
# (app/api/v1/routers/eligibility_rules.py) -- this is display config, not a
# state-machine change, so it doesn't need the narrower
# DESIGNATION_WRITE_ROLES gate.
_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)


def _config_snapshot(config: PipelineStageConfig) -> dict:
    return {
        "role_category": config.role_category.value,
        "sequence_position": config.sequence_position,
        "display_label": config.display_label,
        "maps_to_status": config.maps_to_status.value,
        "maps_to_interview_type": config.maps_to_interview_type.value if config.maps_to_interview_type else None,
        "is_active": config.is_active,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[PipelineStageConfigRead])
def list_pipeline_stage_configs(
    role_category: StaffRoleCategoryEnum | None = Query(None),
    is_active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[PipelineStageConfigRead]:
    query = db.query(PipelineStageConfig)
    if role_category is not None:
        query = query.filter(PipelineStageConfig.role_category == role_category)
    if is_active is not None:
        query = query.filter(PipelineStageConfig.is_active == is_active)

    total = query.count()
    rows = (
        query.order_by(PipelineStageConfig.role_category, PipelineStageConfig.sequence_position)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=PipelineStageConfigRead, status_code=status.HTTP_201_CREATED)
def create_pipeline_stage_config(
    payload: PipelineStageConfigCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> PipelineStageConfig:
    existing = (
        db.query(PipelineStageConfig)
        .filter(
            PipelineStageConfig.role_category == payload.role_category,
            PipelineStageConfig.sequence_position == payload.sequence_position,
        )
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A stage already exists at this sequence_position for this role_category",
        )

    config = PipelineStageConfig(
        role_category=payload.role_category,
        sequence_position=payload.sequence_position,
        display_label=payload.display_label,
        maps_to_status=payload.maps_to_status,
        maps_to_interview_type=payload.maps_to_interview_type,
        is_active=payload.is_active,
    )
    db.add(config)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="PipelineStageConfig",
        entity=config,
        campus_context_id=None,
        after_state=_config_snapshot(config),
        request=request,
    )
    db.commit()
    db.refresh(config)
    return config


@router.patch("/{config_id}", response_model=PipelineStageConfigRead)
def update_pipeline_stage_config(
    config_id: uuid.UUID,
    payload: PipelineStageConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> PipelineStageConfig:
    config = db.get(PipelineStageConfig, config_id)
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _config_snapshot(config)
    updates = payload.model_dump(exclude_unset=True)

    next_role_category = updates.get("role_category", config.role_category)
    next_sequence_position = updates.get("sequence_position", config.sequence_position)
    if ("role_category" in updates or "sequence_position" in updates) and (
        next_role_category != config.role_category or next_sequence_position != config.sequence_position
    ):
        clash = (
            db.query(PipelineStageConfig)
            .filter(
                PipelineStageConfig.role_category == next_role_category,
                PipelineStageConfig.sequence_position == next_sequence_position,
                PipelineStageConfig.id != config.id,
            )
            .one_or_none()
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A stage already exists at this sequence_position for this role_category",
            )

    for field, value in updates.items():
        setattr(config, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="PipelineStageConfig",
        entity=config,
        campus_context_id=None,
        before_state=before,
        after_state=_config_snapshot(config),
        request=request,
    )
    db.commit()
    db.refresh(config)
    return config
