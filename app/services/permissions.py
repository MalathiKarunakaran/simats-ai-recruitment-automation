"""Phase 1 (schema + services only) of the granular permission-matrix epic --
see UserPermissionGrant/PermissionEnum's docstrings for the full context.
Nothing here is wired into any router yet; that's Phase 2's job. This module
is the single source of truth for each role's default permission set, derived
directly from a full audit of every router's actual current role gates (not
guessed).

SUPER_ADMIN and CANDIDATE are deliberately excluded from
DEFAULT_PERMISSIONS_BY_ROLE: SUPER_ADMIN is an implicit bypass everywhere
(see has_permission below), CANDIDATE never reaches any staff-gated endpoint
at all.
"""

from sqlalchemy.orm import Session

from app.models.enums import PermissionEnum, UserRoleEnum
from app.models.user import User
from app.models.user_permission_grant import UserPermissionGrant

DEFAULT_PERMISSIONS_BY_ROLE: dict[UserRoleEnum, frozenset[PermissionEnum]] = {
    UserRoleEnum.HR_ADMIN: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.APPROVE_VACANCY,
            PermissionEnum.REJECT_VACANCY,
            PermissionEnum.PUBLISH_VACANCY,
            PermissionEnum.CLOSE_VACANCY,
            PermissionEnum.CANCEL_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.CREATE_CANDIDATE,
            PermissionEnum.EDIT_CANDIDATE,
            PermissionEnum.MANAGE_APPLICATIONS,
            PermissionEnum.SCHEDULE_INTERVIEW,
            PermissionEnum.RESCHEDULE_INTERVIEW,
            PermissionEnum.CANCEL_INTERVIEW,
            PermissionEnum.JOB_DISTRIBUTION,
            PermissionEnum.RESUME_SCREENING,
            PermissionEnum.OFFERS,
            PermissionEnum.ONBOARDING,
            PermissionEnum.VIEW_EMPLOYEES,
            PermissionEnum.EDIT_EMPLOYEES,
            PermissionEnum.MANAGE_DEPARTMENTS,
            PermissionEnum.MANAGE_LOCATIONS,
            PermissionEnum.MANAGE_USERS,
            PermissionEnum.ACTIVITY_LOG,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.APPROVE_VACANCY,
            PermissionEnum.REJECT_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.VIEW_EMPLOYEES,
            PermissionEnum.ACTIVITY_LOG,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    UserRoleEnum.RECRUITMENT_OFFICER: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.PUBLISH_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.CREATE_CANDIDATE,
            PermissionEnum.EDIT_CANDIDATE,
            PermissionEnum.MANAGE_APPLICATIONS,
            PermissionEnum.SCHEDULE_INTERVIEW,
            PermissionEnum.RESCHEDULE_INTERVIEW,
            PermissionEnum.CANCEL_INTERVIEW,
            PermissionEnum.JOB_DISTRIBUTION,
            PermissionEnum.RESUME_SCREENING,
            PermissionEnum.ONBOARDING,
            PermissionEnum.MANAGE_LOCATIONS,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    UserRoleEnum.CAMPUS_HOD: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.CREATE_VACANCY_REQUEST,
            PermissionEnum.EDIT_VACANCY_REQUEST,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.ACTIVITY_LOG,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    UserRoleEnum.INTERVIEW_PANEL_MEMBER: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.MARK_INTERVIEW_COMPLETED,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    UserRoleEnum.MANAGEMENT: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.VIEW_EMPLOYEES,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
    # Deliberately minimal -- unlike every other role, RECRUITMENT_COORDINATOR's
    # whole design (see CoordinatorCapabilityGrant's own docstring) is that
    # meaningful write access is opt-in per user, granted individually, not
    # blanket by role. This is the default for a *brand-new* coordinator with
    # nothing granted yet; real existing coordinators get their actual current
    # grants preserved via the migration backfill, not this default.
    UserRoleEnum.RECRUITMENT_COORDINATOR: frozenset(
        {
            PermissionEnum.VIEW_VACANCY,
            PermissionEnum.VIEW_CANDIDATES,
            PermissionEnum.REPORTS,
            PermissionEnum.SETTINGS,
        }
    ),
}


def has_permission(db: Session, user: User, permission: PermissionEnum) -> bool:
    """True unconditionally for SUPER_ADMIN (implicit "has every permission"
    bypass, never represented by stored grant rows); otherwise checks whether
    a UserPermissionGrant row exists for (user.id, permission). Not yet
    consulted by any router -- Phase 2's job."""
    if user.role == UserRoleEnum.SUPER_ADMIN:
        return True

    return (
        db.query(UserPermissionGrant)
        .filter(UserPermissionGrant.user_id == user.id, UserPermissionGrant.permission == permission)
        .first()
        is not None
    )


def seed_default_permissions(db: Session, user: User) -> None:
    """Inserts one UserPermissionGrant row per permission in
    DEFAULT_PERMISSIONS_BY_ROLE.get(user.role, frozenset()), skipping
    SUPER_ADMIN/CANDIDATE (no rows needed/applicable). Idempotent -- skips any
    permission the user already has a grant for, same existing-row diffing
    pattern app.api.v1.routers.users.set_user_capabilities already uses, so
    calling this twice never raises a unique-constraint violation."""
    if user.role in (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.CANDIDATE):
        return

    default_permissions = DEFAULT_PERMISSIONS_BY_ROLE.get(user.role, frozenset())
    if not default_permissions:
        return

    existing_permissions = {
        row.permission
        for row in db.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == user.id).all()
    }

    for permission in default_permissions:
        if permission not in existing_permissions:
            db.add(UserPermissionGrant(user_id=user.id, permission=permission))
