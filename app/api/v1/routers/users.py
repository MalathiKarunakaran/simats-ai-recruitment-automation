import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app.core import security
from app.core.deps import (
    CampusScope,
    enforce_campus_match,
    get_campus_scope,
    get_current_active_user,
    get_db,
    require_permission,
    require_roles,
)
from app.models.application import Application
from app.models.approved_vacancy import ApprovedVacancy
from app.models.audit_log import AuditLog
from app.models.auth_token import RefreshToken
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant
from app.models.department import Department
from app.models.employee import Employee
from app.models.enums import USER_MANAGEMENT_ROLES, CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.interview import InterviewFeedback, InterviewPanelAssignment, InterviewSchedule
from app.models.joining import JoiningRecord
from app.models.notification import Notification
from app.models.offer import Offer
from app.models.resume_score import ResumeScore
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory
from app.models.user import User
from app.models.user_department_scope import user_department_scope
from app.models.user_permission_grant import UserPermissionGrant
from app.models.vacancy_request import VacancyRequest
from app.schemas.common import PaginatedResponse
from app.schemas.user import (
    AdminPasswordReset,
    CoordinatorCapabilitiesRead,
    CoordinatorCapabilitiesUpdate,
    UserCreate,
    UserDepartmentScopeRead,
    UserDepartmentScopeUpdate,
    UserPermissionsRead,
    UserPermissionsUpdate,
    UserRead,
    UserSelfUpdate,
    UserUpdate,
)
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.permissions import seed_default_permissions

router = APIRouter(prefix="/users", tags=["users"])


def _user_snapshot(user: User) -> dict:
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "campus_id": user.campus_id,
        "department_id": user.department_id,
        "is_active": user.is_active,
        "phone_number": user.phone_number,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.get("", response_model=PaginatedResponse[UserRead])
def list_users(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> PaginatedResponse[UserRead]:
    query = db.query(User)
    if not scope.is_global:
        query = query.filter(User.campus_id == scope.campus_id)
    total = query.count()
    rows = query.order_by(User.created_at).offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_USERS)),
) -> User:
    if db.query(User).filter(User.email == payload.email).one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    user = User(
        email=payload.email,
        password_hash=security.hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        phone_number=payload.phone_number,
    )
    db.add(user)
    db.flush()  # populate user.id for the audit row before commit
    log_create(
        db,
        actor=current_user,
        entity_type="User",
        entity=user,
        campus_context_id=user.campus_id,
        after_state=_user_snapshot(user),
        request=request,
    )
    seed_default_permissions(db, user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/me", response_model=UserRead)
def read_own_profile(current_user: User = Depends(get_current_active_user)) -> User:
    return current_user


@router.patch("/me", response_model=UserRead)
def update_own_profile(
    payload: UserSelfUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> User:
    before = _user_snapshot(current_user)
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.phone_number is not None:
        current_user.phone_number = payload.phone_number
    if payload.password is not None:
        current_user.password_hash = security.hash_password(payload.password)
        current_user.must_change_password = False
        # Audit M3: a password change ends every OTHER session of this user
        # -- their access tokens stop authorising on the next request, since
        # get_current_user requires a live session family -- while the
        # session that just proved the old password carries on. Same
        # "credential change ends sessions" rule as the reset flows, minus
        # logging the user out of the very screen they are on.
        others = (
            db.query(RefreshToken)
            .filter(
                RefreshToken.user_id == current_user.id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.session_id != request.state.session_id,
            )
            .all()
        )
        for t in others:
            t.revoked_at = datetime.now(timezone.utc)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=current_user,
        campus_context_id=current_user.campus_id,
        before_state=before,
        after_state=_user_snapshot(current_user),
        request=request,
    )
    db.commit()
    db.refresh(current_user)
    return current_user


# NOTE: routes below use a /{user_id} path param and must stay declared after
# the /me routes above -- FastAPI matches in declaration order, so /me would
# otherwise be swallowed as an (invalid) UUID path param.


@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    scope: CampusScope = Depends(get_campus_scope),
) -> User:
    if user_id == current_user.id:
        return current_user

    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    enforce_campus_match(scope, target.campus_id)
    return target


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionEnum.MANAGE_USERS)),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if payload.is_active is False and target.deactivation_protected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account is protected from deactivation.",
        )

    before = _user_snapshot(target)

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    for field in ("full_name", "role", "campus_id", "department_id", "phone_number", "is_active"):
        value = getattr(payload, field)
        if value is not None:
            setattr(target, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state=before,
        after_state=_user_snapshot(target),
        request=request,
    )
    db.commit()
    db.refresh(target)
    return target


@router.post("/{user_id}/reset-password", response_model=UserRead)
def admin_reset_password(
    user_id: uuid.UUID,
    payload: AdminPasswordReset,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> User:
    """SUPER_ADMIN-only (deliberately narrower than USER_MANAGEMENT_ROLES,
    which also includes HR_ADMIN) -- resets another user's password and
    forces them to set a new one on next login via must_change_password.
    Revokes every currently-active refresh token for that user, same
    "credential reset ends all sessions" logic as
    auth.py's password_reset_confirm."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    before = _user_snapshot(target)

    target.password_hash = security.hash_password(payload.password)
    target.must_change_password = True

    active_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
        .all()
    )
    for t in active_tokens:
        t.revoked_at = datetime.now(timezone.utc)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state=before,
        after_state=_user_snapshot(target),
        request=request,
    )
    db.commit()
    db.refresh(target)
    return target


def _user_has_related_records(db: Session, user_id: uuid.UUID) -> bool:
    """Exhaustive check of every FK to users.id that represents real
    recruitment/interview/audit history (deliberately excludes
    app.models.auth_token.* rows and CoordinatorCapabilityGrant.user_id --
    those are session data / the target's own role config, both
    ondelete="CASCADE" and fine to let cascade-delete silently)."""
    checks = [
        (Application, Application.recorded_by_id),
        (ApprovedVacancy, ApprovedVacancy.approved_by_id),
        (AuditLog, AuditLog.actor_user_id),
        (BulkUploadLog, BulkUploadLog.uploaded_by_id),
        (BulkUploadLog, BulkUploadLog.undone_by_id),
        (CoordinatorCapabilityGrant, CoordinatorCapabilityGrant.granted_by_id),
        (Employee, Employee.user_id),
        (Employee, Employee.separated_by_id),
        (HousekeepingStaff, HousekeepingStaff.created_by_id),
        (HousekeepingStaff, HousekeepingStaff.updated_by_id),
        (InterviewSchedule, InterviewSchedule.scheduled_by_id),
        (InterviewPanelAssignment, InterviewPanelAssignment.panel_member_id),
        (InterviewFeedback, InterviewFeedback.panel_member_id),
        (JoiningRecord, JoiningRecord.onboarding_completed_by_id),
        (Notification, Notification.recipient_user_id),
        (Offer, Offer.offered_by_id),
        (ResumeScore, ResumeScore.screened_by_id),
        (SanctionedStrength, SanctionedStrength.created_by_id),
        (SanctionedStrength, SanctionedStrength.updated_by_id),
        (SanctionedStrengthHistory, SanctionedStrengthHistory.changed_by_id),
        (VacancyRequest, VacancyRequest.requested_by_id),
        (VacancyRequest, VacancyRequest.dean_reviewed_by_id),
        (VacancyRequest, VacancyRequest.hr_reviewed_by_id),
        (VacancyRequest, VacancyRequest.rejected_by_id),
        (VacancyRequest, VacancyRequest.cancelled_by_id),
    ]
    for model, column in checks:
        if db.query(model).filter(column == user_id).first() is not None:
            return True
    return False


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> Response:
    """SUPER_ADMIN-only (deliberately narrower than USER_MANAGEMENT_ROLES,
    same narrowing as admin_reset_password -- deleting a user is at least as
    sensitive as resetting their password). Hard-deletes a user only when it
    is actually safe to do so: no related recruitment, interview, or audit
    history anywhere in the system. Reintroduced deliberately -- see
    tests/test_delete_user.py; the old blanket "route removed" regression
    test in test_users_rbac.py has been removed in favor of the real
    coverage in that file."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if target.role == UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Super Admin accounts cannot be deleted.",
        )

    if target.deactivation_protected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account is protected and cannot be deleted.",
        )

    if _user_has_related_records(db, target.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This user has related recruitment, interview, or audit history and "
                "cannot be deleted. Deactivate the account instead."
            ),
        )

    before = _user_snapshot(target)
    log_delete(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state=before,
        request=request,
    )
    db.delete(target)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/force-logout", status_code=status.HTTP_204_NO_CONTENT)
def force_logout_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*USER_MANAGEMENT_ROLES)),
) -> Response:
    """SUPER_ADMIN + HR_ADMIN (USER_MANAGEMENT_ROLES) -- lower severity than
    admin_reset_password's SUPER_ADMIN-only narrowing since no credential or
    profile field actually changes here, just active session revocation."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    active_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
        .all()
    )
    for t in active_tokens:
        t.revoked_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=current_user,
        action="FORCE_LOGOUT",
        entity_type="User",
        entity_id=target.id,
        campus_context_id=target.campus_id,
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _capabilities_of(db: Session, user_id: uuid.UUID) -> list[CoordinatorCapabilityEnum]:
    rows = db.query(CoordinatorCapabilityGrant).filter(CoordinatorCapabilityGrant.user_id == user_id).all()
    return [row.capability for row in rows]


@router.get("/{user_id}/capabilities", response_model=CoordinatorCapabilitiesRead)
def get_user_capabilities(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> CoordinatorCapabilitiesRead:
    """Readable by SUPER_ADMIN (any user) or by the user themselves (their
    own record only) -- deliberately narrower than get_user's broader
    campus-scoped staff read, since this exposes what a coordinator is
    allowed to do, not just their profile."""
    if user_id != current_user.id and current_user.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return CoordinatorCapabilitiesRead(capabilities=_capabilities_of(db, target.id))


@router.put("/{user_id}/capabilities", response_model=CoordinatorCapabilitiesRead)
def set_user_capabilities(
    user_id: uuid.UUID,
    payload: CoordinatorCapabilitiesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> CoordinatorCapabilitiesRead:
    """Full replace: the caller sends the complete desired capability set for
    the target RECRUITMENT_COORDINATOR; the server diffs against current
    grants and adds/removes rows to reach that exact end state in one call."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if target.role != UserRoleEnum.RECRUITMENT_COORDINATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Capability grants only apply to RECRUITMENT_COORDINATOR users",
        )

    existing = (
        db.query(CoordinatorCapabilityGrant).filter(CoordinatorCapabilityGrant.user_id == target.id).all()
    )
    existing_by_capability = {row.capability: row for row in existing}
    desired = set(payload.capabilities)

    before = sorted(cap.value for cap in existing_by_capability)

    for capability, row in existing_by_capability.items():
        if capability not in desired:
            db.delete(row)

    for capability in desired:
        if capability not in existing_by_capability:
            db.add(
                CoordinatorCapabilityGrant(
                    user_id=target.id,
                    capability=capability,
                    granted_by_id=current_user.id,
                )
            )

    after = sorted(cap.value for cap in desired)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state={"capabilities": before},
        after_state={"capabilities": after},
        request=request,
    )
    db.commit()

    return CoordinatorCapabilitiesRead(capabilities=_capabilities_of(db, target.id))


def _permissions_of(db: Session, user_id: uuid.UUID) -> list[PermissionEnum]:
    rows = db.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == user_id).all()
    return [row.permission for row in rows]


@router.get("/{user_id}/permissions", response_model=UserPermissionsRead)
def get_user_permissions(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserPermissionsRead:
    """Readable by SUPER_ADMIN (any user) or by the user themselves (their
    own record only) -- same narrowing as get_user_capabilities, since this
    exposes what a user is granted access to do, not just their profile."""
    if user_id != current_user.id and current_user.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return UserPermissionsRead(permissions=_permissions_of(db, target.id))


@router.put("/{user_id}/permissions", response_model=UserPermissionsRead)
def set_user_permissions(
    user_id: uuid.UUID,
    payload: UserPermissionsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> UserPermissionsRead:
    """Full replace: the caller sends the complete desired permission set for
    the target user; the server diffs against current grants and adds/removes
    rows to reach that exact end state in one call. SUPER_ADMIN-only
    (deliberately narrower than require_permission(MANAGE_USERS)) since
    granting fine-grained permissions -- including MANAGE_USERS itself -- is
    a bigger, self-escalating power than ordinary user management, same
    reasoning as set_user_capabilities' own narrowing. Unlike
    set_user_capabilities, applies to any staff role -- not just
    RECRUITMENT_COORDINATOR -- except SUPER_ADMIN (implicit bypass, never
    represented by grant rows) and CANDIDATE (never reaches a staff-gated
    endpoint), both of which 400."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if target.role in (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.CANDIDATE):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Permission grants do not apply to SUPER_ADMIN or CANDIDATE users",
        )

    existing = db.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == target.id).all()
    existing_by_permission = {row.permission: row for row in existing}
    desired = set(payload.permissions)

    before = sorted(perm.value for perm in existing_by_permission)

    for permission, row in existing_by_permission.items():
        if permission not in desired:
            db.delete(row)

    for permission in desired:
        if permission not in existing_by_permission:
            db.add(
                UserPermissionGrant(
                    user_id=target.id,
                    permission=permission,
                    granted_by_id=current_user.id,
                )
            )

    after = sorted(perm.value for perm in desired)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state={"permissions": before},
        after_state={"permissions": after},
        request=request,
    )
    db.commit()

    return UserPermissionsRead(permissions=_permissions_of(db, target.id))


def _department_scope_of(db: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    rows = db.execute(
        user_department_scope.select().where(user_department_scope.c.user_id == user_id)
    ).all()
    return [row.department_id for row in rows]


@router.get("/{user_id}/department-scope", response_model=UserDepartmentScopeRead)
def get_user_department_scope(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserDepartmentScopeRead:
    """Readable by SUPER_ADMIN (any user) or by the user themselves (their
    own record only) -- same narrowing as get_user_capabilities/
    get_user_permissions."""
    if user_id != current_user.id and current_user.role != UserRoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return UserDepartmentScopeRead(department_ids=_department_scope_of(db, target.id))


@router.put("/{user_id}/department-scope", response_model=UserDepartmentScopeRead)
def set_user_department_scope(
    user_id: uuid.UUID,
    payload: UserDepartmentScopeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRoleEnum.SUPER_ADMIN)),
) -> UserDepartmentScopeRead:
    """Full replace: the caller sends the complete desired department-scope
    list for the target user; the server diffs against the current
    user_department_scope rows and adds/removes rows to reach that exact end
    state in one call. SUPER_ADMIN-only, same narrowing as
    set_user_capabilities/set_user_permissions. No role restriction on the
    target -- any staff role can have department scope."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    desired = set(payload.department_ids)
    if desired:
        found_ids = {
            row.id for row in db.query(Department.id).filter(Department.id.in_(desired)).all()
        }
        unknown_ids = desired - found_ids
        if unknown_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown department_id(s): {', '.join(str(i) for i in sorted(unknown_ids, key=str))}",
            )

    existing = set(_department_scope_of(db, target.id))

    before = sorted(str(i) for i in existing)

    to_remove = existing - desired
    to_add = desired - existing

    if to_remove:
        db.execute(
            delete(user_department_scope).where(
                user_department_scope.c.user_id == target.id,
                user_department_scope.c.department_id.in_(to_remove),
            )
        )
    if to_add:
        db.execute(
            insert(user_department_scope),
            [{"user_id": target.id, "department_id": department_id} for department_id in to_add],
        )

    after = sorted(str(i) for i in desired)

    log_update(
        db,
        actor=current_user,
        entity_type="User",
        entity=target,
        campus_context_id=target.campus_id,
        before_state={"department_ids": before},
        after_state={"department_ids": after},
        request=request,
    )
    db.commit()

    return UserDepartmentScopeRead(department_ids=_department_scope_of(db, target.id))
