import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.campus import Campus
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.eligibility_rule import EligibilityRuleCreate, EligibilityRuleRead, EligibilityRuleUpdate
from app.services.audit import log_create, log_update

router = APIRouter(prefix="/eligibility-rules", tags=["eligibility-rules"])

_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)


def _rule_snapshot(rule: EligibilityRule) -> dict:
    return {
        "campus_id": rule.campus_id,
        "staff_category": rule.staff_category.value,
        "position_title": rule.position_title,
        "required_qualification_keyword": rule.required_qualification_keyword,
        "net_set_required": rule.net_set_required,
        "subject": rule.subject,
        "skills_keyword": rule.skills_keyword,
        "id_proof_required": rule.id_proof_required,
        "shift_preference": rule.shift_preference,
        "is_active": rule.is_active,
        "notes": rule.notes,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[EligibilityRuleRead])
def list_eligibility_rules(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[EligibilityRuleRead]:
    query = db.query(EligibilityRule)
    total = query.count()
    rows = query.order_by(EligibilityRule.created_at.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=EligibilityRuleRead, status_code=status.HTTP_201_CREATED)
def create_eligibility_rule(
    payload: EligibilityRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRule:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    rule = EligibilityRule(
        campus_id=payload.campus_id,
        staff_category=payload.staff_category,
        position_title=payload.position_title,
        required_qualification_keyword=payload.required_qualification_keyword,
        net_set_required=payload.net_set_required,
        subject=payload.subject,
        skills_keyword=payload.skills_keyword,
        id_proof_required=payload.id_proof_required,
        shift_preference=payload.shift_preference,
        is_active=payload.is_active,
        notes=payload.notes,
    )
    db.add(rule)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=rule,
        campus_context_id=rule.campus_id,
        after_state=_rule_snapshot(rule),
        request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=EligibilityRuleRead)
def update_eligibility_rule(
    rule_id: uuid.UUID,
    payload: EligibilityRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRule:
    rule = db.get(EligibilityRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")

    before = _rule_snapshot(rule)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(rule, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=rule,
        campus_context_id=rule.campus_id,
        before_state=before,
        after_state=_rule_snapshot(rule),
        request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule
