"""Admin CRUD for recruitment channels and channel rules.

Reference tables, not state machines -- same write gate as pipeline stage
configs and eligibility rules (Super Admin, HR Admin). No DELETE: a channel
that has ever been posted to is referenced by job_posting_channels
(RESTRICT), and a rule is cheap to leave inactive; both deactivate instead.
Every write is audited with a before/after snapshot.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_roles_or_permission
from app.models.campus import Campus
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import PermissionEnum, RecruitmentChannelModeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.recruitment_channel import ChannelRule, RecruitmentChannel
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.recruitment_channel import (
    ChannelRuleCreate,
    ChannelRuleRead,
    ChannelRuleUpdate,
    RecruitmentChannelCreate,
    RecruitmentChannelRead,
    RecruitmentChannelUpdate,
)
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/recruitment-channels", tags=["recruitment-channels"])
rules_router = APIRouter(prefix="/channel-rules", tags=["recruitment-channels"])

# MANAGE_RECRUITMENT_CHANNELS, OR the two roles that historically owned
# reference tables -- nobody loses access they had before the permission
# existed (same additive shape as the vacancy workflow's gates).
_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)


def _write_gate(
    current_user: User = Depends(
        require_roles_or_permission(PermissionEnum.MANAGE_RECRUITMENT_CHANNELS, *_WRITE_ROLES)
    ),
) -> User:
    return current_user


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _channel_snapshot(channel: RecruitmentChannel) -> dict:
    return {
        "code": channel.code,
        "name": channel.name,
        "kind": channel.kind.value,
        "mode": channel.mode.value,
        "integration_path": channel.integration_path,
        "config": channel.config,
        "applicable_categories": [c.value for c in channel.applicable_categories],
        "applicable_campus_ids": [str(c) for c in channel.applicable_campus_ids],
        "is_active": channel.is_active,
        "display_order": channel.display_order,
    }


def _rule_snapshot(rule: ChannelRule) -> dict:
    return {
        "name": rule.name,
        "is_active": rule.is_active,
        "priority": rule.priority,
        "match_category": rule.match_category.value if rule.match_category else None,
        "match_campus_id": str(rule.match_campus_id) if rule.match_campus_id else None,
        "match_department_id": str(rule.match_department_id) if rule.match_department_id else None,
        "match_designation_id": str(rule.match_designation_id) if rule.match_designation_id else None,
        "match_employment_type": rule.match_employment_type.value if rule.match_employment_type else None,
        "channel_ids": [str(c) for c in rule.channel_ids],
        "auto_select": rule.auto_select,
    }


def _validate_mode_and_path(mode: RecruitmentChannelModeEnum, integration_path: str | None) -> None:
    if mode in (RecruitmentChannelModeEnum.MANUAL_ASSISTED, RecruitmentChannelModeEnum.INTERNAL) and integration_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A {mode.value} channel has no integration path",
        )


def _validate_campus_ids(db: Session, campus_ids: list[uuid.UUID]) -> None:
    if not campus_ids:
        return
    found = set(db.execute(select(Campus.id).where(Campus.id.in_(campus_ids))).scalars())
    missing = [str(c) for c in campus_ids if c not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown campus id(s): {', '.join(missing)}")


def _validate_channel_ids(db: Session, channel_ids: list[uuid.UUID]) -> None:
    found = set(db.execute(select(RecruitmentChannel.id).where(RecruitmentChannel.id.in_(channel_ids))).scalars())
    missing = [str(c) for c in channel_ids if c not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown channel id(s): {', '.join(missing)}"
        )


def _validate_rule_targets(db: Session, payload) -> None:
    if payload.match_campus_id is not None and db.get(Campus, payload.match_campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown match_campus_id")
    if payload.match_department_id is not None:
        department = db.get(Department, payload.match_department_id)
        if department is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown match_department_id")
        if payload.match_campus_id is not None and department.campus_id != payload.match_campus_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="match_department_id is not on match_campus_id"
            )
    if payload.match_designation_id is not None and db.get(Designation, payload.match_designation_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown match_designation_id")


# --- Channels ---------------------------------------------------------------


@router.get("", response_model=PaginatedResponse[RecruitmentChannelRead])
def list_recruitment_channels(
    is_active: bool | None = Query(None),
    mode: RecruitmentChannelModeEnum | None = Query(None),
    category: StaffRoleCategoryEnum | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[RecruitmentChannelRead]:
    query = db.query(RecruitmentChannel)
    if is_active is not None:
        query = query.filter(RecruitmentChannel.is_active == is_active)
    if mode is not None:
        query = query.filter(RecruitmentChannel.mode == mode)
    rows = query.order_by(RecruitmentChannel.display_order, RecruitmentChannel.code).all()
    if category is not None:
        # "Empty = all" is an application rule, so filter in Python rather
        # than with an array operator that would miss the empty case.
        rows = [r for r in rows if not r.applicable_categories or category in r.applicable_categories]
    total = len(rows)
    return PaginatedResponse(items=rows[offset : offset + limit], total=total, limit=limit, offset=offset)


@router.get("/{channel_id}", response_model=RecruitmentChannelRead)
def get_recruitment_channel(
    channel_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> RecruitmentChannel:
    channel = db.get(RecruitmentChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return channel


@router.post("", response_model=RecruitmentChannelRead, status_code=status.HTTP_201_CREATED)
def create_recruitment_channel(
    payload: RecruitmentChannelCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> RecruitmentChannel:
    if db.execute(select(RecruitmentChannel.id).where(RecruitmentChannel.code == payload.code)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A channel with this code already exists")
    _validate_mode_and_path(payload.mode, payload.integration_path)
    _validate_campus_ids(db, payload.applicable_campus_ids)

    channel = RecruitmentChannel(**payload.model_dump())
    db.add(channel)
    db.flush()
    log_create(
        db, actor=current_user, entity_type="RecruitmentChannel", entity=channel, campus_context_id=None,
        after_state=_channel_snapshot(channel), request=request,
    )
    db.commit()
    db.refresh(channel)
    return channel


@router.patch("/{channel_id}", response_model=RecruitmentChannelRead)
def update_recruitment_channel(
    channel_id: uuid.UUID,
    payload: RecruitmentChannelUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> RecruitmentChannel:
    channel = db.get(RecruitmentChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return channel
    before = _channel_snapshot(channel)
    mode = changes.get("mode", channel.mode)
    path = changes.get("integration_path", channel.integration_path)
    _validate_mode_and_path(mode, path)
    if "applicable_campus_ids" in changes:
        _validate_campus_ids(db, changes["applicable_campus_ids"])
    for field, value in changes.items():
        setattr(channel, field, value)
    db.flush()
    log_update(
        db, actor=current_user, entity_type="RecruitmentChannel", entity=channel, campus_context_id=None,
        before_state=before, after_state=_channel_snapshot(channel), request=request,
    )
    db.commit()
    db.refresh(channel)
    return channel


# --- Rules ------------------------------------------------------------------


@rules_router.get("", response_model=PaginatedResponse[ChannelRuleRead])
def list_channel_rules(
    is_active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[ChannelRuleRead]:
    query = db.query(ChannelRule)
    if is_active is not None:
        query = query.filter(ChannelRule.is_active == is_active)
    total = query.count()
    rows = query.order_by(ChannelRule.priority.desc(), ChannelRule.name).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@rules_router.post("", response_model=ChannelRuleRead, status_code=status.HTTP_201_CREATED)
def create_channel_rule(
    payload: ChannelRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> ChannelRule:
    _validate_rule_targets(db, payload)
    _validate_channel_ids(db, payload.channel_ids)
    rule = ChannelRule(**payload.model_dump())
    db.add(rule)
    db.flush()
    log_create(
        db, actor=current_user, entity_type="ChannelRule", entity=rule, campus_context_id=None, after_state=_rule_snapshot(rule),
        request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule


@rules_router.patch("/{rule_id}", response_model=ChannelRuleRead)
def update_channel_rule(
    rule_id: uuid.UUID,
    payload: ChannelRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_write_gate),
) -> ChannelRule:
    rule = db.get(ChannelRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return rule
    before = _rule_snapshot(rule)
    merged = ChannelRuleCreate(**{**_rule_payload(rule), **changes})
    _validate_rule_targets(db, merged)
    if "channel_ids" in changes:
        _validate_channel_ids(db, changes["channel_ids"])
    for field, value in changes.items():
        setattr(rule, field, value)
    db.flush()
    log_update(
        db, actor=current_user, entity_type="ChannelRule", entity=rule, campus_context_id=None, before_state=before,
        after_state=_rule_snapshot(rule), request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule


def _rule_payload(rule: ChannelRule) -> dict:
    return {
        "name": rule.name,
        "is_active": rule.is_active,
        "priority": rule.priority,
        "match_category": rule.match_category,
        "match_campus_id": rule.match_campus_id,
        "match_department_id": rule.match_department_id,
        "match_designation_id": rule.match_designation_id,
        "match_employment_type": rule.match_employment_type,
        "channel_ids": list(rule.channel_ids),
        "auto_select": rule.auto_select,
        "notes": rule.notes,
    }
