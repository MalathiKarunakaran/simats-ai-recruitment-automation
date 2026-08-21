from app.models.enums import PermissionEnum, UserRoleEnum
from app.models.user_permission_grant import UserPermissionGrant

from tests.conftest import auth_headers


def test_super_admin_can_grant_permissions_via_put(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY", "APPROVE_VACANCY"]},
    )
    assert response.status_code == 200
    assert sorted(response.json()["permissions"]) == ["APPROVE_VACANCY", "VIEW_VACANCY"]

    read_back = client.get(
        f"/api/v1/users/{hr_admin.id}/permissions", headers=auth_headers(client, admin)
    )
    assert read_back.status_code == 200
    assert sorted(read_back.json()["permissions"]) == ["APPROVE_VACANCY", "VIEW_VACANCY"]


def test_put_permissions_is_a_full_replace_not_additive(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY", "APPROVE_VACANCY"]},
    )

    second = client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_CANDIDATES"]},
    )
    assert second.status_code == 200
    assert second.json()["permissions"] == ["VIEW_CANDIDATES"]


def test_put_permissions_to_empty_list_revokes_all(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    revoked = client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": []},
    )
    assert revoked.status_code == 200
    assert revoked.json()["permissions"] == []


def test_put_permissions_forbidden_for_non_super_admin(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)

    response = client.put(
        f"/api/v1/users/{officer.id}/permissions",
        headers=auth_headers(client, hr_admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    assert response.status_code == 403


def test_get_permissions_forbidden_for_non_self_non_super_admin(client, user_factory):
    officer_a = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    officer_b = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)

    response = client.get(
        f"/api/v1/users/{officer_b.id}/permissions", headers=auth_headers(client, officer_a)
    )
    assert response.status_code == 403


def test_user_can_read_own_permissions(client, user_factory, grant_permission):
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    # APPROVE_VACANCY is not part of RECRUITMENT_OFFICER's default seeded set
    # (see app.services.permissions.DEFAULT_PERMISSIONS_BY_ROLE), so this is
    # unambiguously a grant, not a pre-existing default.
    grant_permission(officer, PermissionEnum.APPROVE_VACANCY)

    response = client.get(
        f"/api/v1/users/{officer.id}/permissions", headers=auth_headers(client, officer)
    )
    assert response.status_code == 200
    assert "APPROVE_VACANCY" in response.json()["permissions"]


def test_get_permissions_404_for_unknown_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.get(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/permissions",
        headers=auth_headers(client, admin),
    )
    assert response.status_code == 404


def test_put_permissions_404_for_unknown_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.put(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    assert response.status_code == 404


def test_put_permissions_400_for_super_admin_target(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    other_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.put(
        f"/api/v1/users/{other_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    assert response.status_code == 400


def test_put_permissions_400_for_candidate_target(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    response = client.put(
        f"/api/v1/users/{candidate.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    assert response.status_code == 400


def test_put_permissions_applies_to_any_non_excluded_role(client, user_factory):
    """Unlike capabilities, permissions apply to any staff role -- not just
    RECRUITMENT_COORDINATOR."""
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)

    response = client.put(
        f"/api/v1/users/{hod.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["VIEW_VACANCY"]},
    )
    assert response.status_code == 200
    assert response.json()["permissions"] == ["VIEW_VACANCY"]


def test_granted_by_id_set_correctly(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    # DELETE_CANDIDATE is not part of HR_ADMIN's default seeded set (see
    # app.services.permissions.DEFAULT_PERMISSIONS_BY_ROLE), so this PUT is
    # guaranteed to insert a brand-new row rather than leave an existing
    # (granted_by_id=None) default-seeded row untouched.
    response = client.put(
        f"/api/v1/users/{hr_admin.id}/permissions",
        headers=auth_headers(client, admin),
        json={"permissions": ["DELETE_CANDIDATE"]},
    )
    assert response.status_code == 200

    row = (
        db_session.query(UserPermissionGrant)
        .filter(
            UserPermissionGrant.user_id == hr_admin.id,
            UserPermissionGrant.permission == PermissionEnum.DELETE_CANDIDATE,
        )
        .one()
    )
    assert row.granted_by_id == admin.id
