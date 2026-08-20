from app.models.enums import PermissionEnum, UserRoleEnum
from app.models.user_permission_grant import UserPermissionGrant
from app.services.permissions import (
    DEFAULT_PERMISSIONS_BY_ROLE,
    has_permission,
    seed_default_permissions,
)

from tests.conftest import auth_headers


def test_has_permission_true_for_super_admin_regardless_of_grants(db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    assert has_permission(db_session, admin, PermissionEnum.MANAGE_USERS) is True
    assert has_permission(db_session, admin, PermissionEnum.CANCEL_VACANCY) is True


def test_has_permission_false_then_true_once_grant_inserted(db_session, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    assert has_permission(db_session, hod, PermissionEnum.APPROVE_VACANCY) is False

    db_session.add(UserPermissionGrant(user_id=hod.id, permission=PermissionEnum.APPROVE_VACANCY))
    db_session.flush()

    assert has_permission(db_session, hod, PermissionEnum.APPROVE_VACANCY) is True


def test_seed_default_permissions_grants_documented_hr_admin_set(db_session, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    seed_default_permissions(db_session, hr_admin)
    db_session.flush()

    granted = {
        row.permission
        for row in db_session.query(UserPermissionGrant)
        .filter(UserPermissionGrant.user_id == hr_admin.id)
        .all()
    }
    assert granted == DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.HR_ADMIN]


def test_seed_default_permissions_grants_documented_campus_hod_set(db_session, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    seed_default_permissions(db_session, hod)
    db_session.flush()

    granted = {
        row.permission
        for row in db_session.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == hod.id).all()
    }
    assert granted == DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.CAMPUS_HOD]
    assert granted == {
        PermissionEnum.VIEW_VACANCY,
        PermissionEnum.CREATE_VACANCY_REQUEST,
        PermissionEnum.EDIT_VACANCY_REQUEST,
        PermissionEnum.VIEW_CANDIDATES,
        PermissionEnum.ACTIVITY_LOG,
        PermissionEnum.REPORTS,
        PermissionEnum.SETTINGS,
    }


def test_seed_default_permissions_grants_minimal_coordinator_set(db_session, user_factory):
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    seed_default_permissions(db_session, coordinator)
    db_session.flush()

    granted = {
        row.permission
        for row in db_session.query(UserPermissionGrant)
        .filter(UserPermissionGrant.user_id == coordinator.id)
        .all()
    }
    assert granted == {
        PermissionEnum.VIEW_VACANCY,
        PermissionEnum.VIEW_CANDIDATES,
        PermissionEnum.REPORTS,
        PermissionEnum.SETTINGS,
    }
    assert granted == DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.RECRUITMENT_COORDINATOR]


def test_seed_default_permissions_is_idempotent(db_session, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    seed_default_permissions(db_session, hr_admin)
    db_session.flush()
    seed_default_permissions(db_session, hr_admin)
    db_session.flush()  # would raise IntegrityError on a unique-constraint violation if not idempotent

    rows = (
        db_session.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == hr_admin.id).all()
    )
    assert len(rows) == len(DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.HR_ADMIN])


def test_seed_default_permissions_no_rows_for_super_admin_or_candidate(db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    seed_default_permissions(db_session, admin)
    seed_default_permissions(db_session, candidate)
    db_session.flush()

    assert (
        db_session.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == admin.id).count() == 0
    )
    assert (
        db_session.query(UserPermissionGrant).filter(UserPermissionGrant.user_id == candidate.id).count()
        == 0
    )


def test_post_users_seeds_default_permission_grants_for_new_user(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "new.hr.admin@example.com",
            "password": "SomePass123!",
            "full_name": "New HR Admin",
            "role": "HR_ADMIN",
        },
    )
    assert response.status_code == 201
    new_user_id = response.json()["id"]

    rows = (
        db_session.query(UserPermissionGrant)
        .filter(UserPermissionGrant.user_id == new_user_id)
        .all()
    )
    granted = {row.permission for row in rows}

    assert granted == DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.HR_ADMIN]
