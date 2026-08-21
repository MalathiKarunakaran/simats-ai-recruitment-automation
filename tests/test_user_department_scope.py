import uuid

from app.models.enums import UserRoleEnum
from app.models.user_department_scope import user_department_scope

from tests.conftest import auth_headers


def test_super_admin_can_set_department_scope_via_put(client, user_factory, department_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    dept_a = department_factory("SSE")
    dept_b = department_factory("SCLAS")

    response = client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_a.id), str(dept_b.id)]},
    )
    assert response.status_code == 200
    assert sorted(response.json()["department_ids"]) == sorted([str(dept_a.id), str(dept_b.id)])

    read_back = client.get(
        f"/api/v1/users/{officer.id}/department-scope", headers=auth_headers(client, admin)
    )
    assert read_back.status_code == 200
    assert sorted(read_back.json()["department_ids"]) == sorted([str(dept_a.id), str(dept_b.id)])


def test_put_department_scope_is_a_full_replace_not_additive(client, user_factory, department_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    dept_a = department_factory("SSE")
    dept_b = department_factory("SCLAS")

    client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_a.id), str(dept_b.id)]},
    )

    second = client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_b.id)]},
    )
    assert second.status_code == 200
    assert second.json()["department_ids"] == [str(dept_b.id)]


def test_put_department_scope_to_empty_list_revokes_all(client, user_factory, department_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    dept_a = department_factory("SSE")

    client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_a.id)]},
    )
    revoked = client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": []},
    )
    assert revoked.status_code == 200
    assert revoked.json()["department_ids"] == []


def test_put_department_scope_forbidden_for_non_super_admin(client, user_factory, department_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    dept_a = department_factory("SSE")

    response = client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, hr_admin),
        json={"department_ids": [str(dept_a.id)]},
    )
    assert response.status_code == 403


def test_get_department_scope_forbidden_for_non_self_non_super_admin(client, user_factory):
    officer_a = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    officer_b = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)

    response = client.get(
        f"/api/v1/users/{officer_b.id}/department-scope", headers=auth_headers(client, officer_a)
    )
    assert response.status_code == 403


def test_user_can_read_own_department_scope(client, db_session, user_factory, department_factory):
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)
    dept_a = department_factory("SSE")
    db_session.execute(
        user_department_scope.insert().values(user_id=officer.id, department_id=dept_a.id)
    )
    db_session.flush()

    response = client.get(
        f"/api/v1/users/{officer.id}/department-scope", headers=auth_headers(client, officer)
    )
    assert response.status_code == 200
    assert response.json()["department_ids"] == [str(dept_a.id)]


def test_get_department_scope_404_for_unknown_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.get(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/department-scope",
        headers=auth_headers(client, admin),
    )
    assert response.status_code == 404


def test_put_department_scope_404_for_unknown_user(client, user_factory, department_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    dept_a = department_factory("SSE")
    response = client.put(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_a.id)]},
    )
    assert response.status_code == 404


def test_put_department_scope_400_for_unknown_department_id(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER)

    response = client.put(
        f"/api/v1/users/{officer.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(uuid.uuid4())]},
    )
    assert response.status_code == 400


def test_put_department_scope_applies_to_any_role(client, user_factory, department_factory):
    """No role restriction on target -- any staff role can have department
    scope."""
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    dept_a = department_factory("SSE")

    response = client.put(
        f"/api/v1/users/{hod.id}/department-scope",
        headers=auth_headers(client, admin),
        json={"department_ids": [str(dept_a.id)]},
    )
    assert response.status_code == 200
    assert response.json()["department_ids"] == [str(dept_a.id)]
