"""Deleting stays Super Admin only (user decision, 31-Oct-2026).

A RECRUITMENT_COORDINATOR is refused on every DELETE route they could
otherwise reach -- including through an individually-granted permission --
with 403 "Only a Super Admin can delete". Super Admin keeps deleting, and one
other role per endpoint is pinned to show its access did NOT change.
"""

import pytest

from app.models.enums import PermissionEnum, UserRoleEnum

from tests.conftest import auth_headers

REFUSED = "Only a Super Admin can delete"


def _draft_vacancy_request(client, hod, department) -> str:
    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json={
            "campus_id": str(department.campus_id),
            "department_id": str(department.id),
            "role_category": "TEACHING",
            "position_title": "Assistant Professor",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "PhD",
            "experience_required": "3+ years",
            "priority": "HIGH",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture()
def coordinator(user_factory, grant_permission):
    """A coordinator holding every permission a delete route checks -- the
    refusal must hold even then, not only for a coordinator with no grants."""
    user = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    for permission in (
        PermissionEnum.EDIT_VACANCY_REQUEST,
        PermissionEnum.MANAGE_DEPARTMENTS,
        PermissionEnum.MANAGE_LOCATIONS,
        PermissionEnum.DELETE_SANCTIONED_STRENGTH,
        PermissionEnum.MANAGE_CAMPUSES,
        PermissionEnum.DELETE_CANDIDATE,
    ):
        grant_permission(user, permission)
    return user


def _assert_refused(response):
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == REFUSED


def test_coordinator_without_grants_gets_the_same_message(client, user_factory, candidate_factory):
    bare = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    candidate = candidate_factory()
    _assert_refused(client.delete(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, bare)))


def test_vacancy_request_delete(client, user_factory, department_factory, coordinator):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    vr_id = _draft_vacancy_request(client, hod, department)
    _assert_refused(client.delete(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, coordinator)))
    assert client.delete(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, admin)).status_code == 204

    # CAMPUS_HOD keeps deleting their own drafts.
    vr_id = _draft_vacancy_request(client, hod, department)
    assert client.delete(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hod)).status_code == 204


def test_department_delete(client, user_factory, department_factory, coordinator):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    first, second = department_factory("SSE"), department_factory("SSE")

    _assert_refused(client.delete(f"/api/v1/departments/{first.id}", headers=auth_headers(client, coordinator)))
    assert client.delete(f"/api/v1/departments/{first.id}", headers=auth_headers(client, admin)).status_code == 204
    assert client.delete(f"/api/v1/departments/{second.id}", headers=auth_headers(client, hr)).status_code == 204


def test_location_delete(client, user_factory, location_factory, coordinator):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    first, second = location_factory("SSE"), location_factory("SSE")

    _assert_refused(client.delete(f"/api/v1/locations/{first.id}", headers=auth_headers(client, coordinator)))
    assert client.delete(f"/api/v1/locations/{first.id}", headers=auth_headers(client, admin)).status_code == 204
    assert client.delete(f"/api/v1/locations/{second.id}", headers=auth_headers(client, hr)).status_code == 204


def test_designation_delete(client, user_factory, designation_factory, coordinator):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    designation = designation_factory()

    _assert_refused(client.delete(f"/api/v1/designations/{designation.id}", headers=auth_headers(client, coordinator)))
    # HR_ADMIN was never in DESIGNATION_WRITE_ROLES -- still refused, with the generic message.
    hr_response = client.delete(f"/api/v1/designations/{designation.id}", headers=auth_headers(client, hr))
    assert hr_response.status_code == 403
    assert hr_response.json()["detail"] != REFUSED
    assert client.delete(f"/api/v1/designations/{designation.id}", headers=auth_headers(client, admin)).status_code == 204


def test_designation_create_and_edit_unchanged_for_coordinator(client, coordinator, designation_factory):
    designation = designation_factory()
    response = client.patch(
        f"/api/v1/designations/{designation.id}",
        headers=auth_headers(client, coordinator),
        json={"qualification": "Changed"},
    )
    assert response.status_code == 200, response.text


def test_sanctioned_strength_delete(
    client, user_factory, campus_factory, department_factory, designation_factory, sanctioned_strength_factory,
    coordinator,
):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    campus = campus_factory("SSE")
    rows = []
    for _ in range(2):
        department = department_factory("SSE")
        designation = designation_factory(department=department)
        rows.append(
            sanctioned_strength_factory(
                campus=campus, department=department, designation=designation, created_by=admin
            )
        )

    url = "/api/v1/sanctioned-strength/{}"
    _assert_refused(client.delete(url.format(rows[0].id), headers=auth_headers(client, coordinator)))
    assert client.delete(url.format(rows[0].id), headers=auth_headers(client, admin)).status_code == 204
    assert client.delete(url.format(rows[1].id), headers=auth_headers(client, hr)).status_code == 204


def test_campus_delete(client, user_factory, campus_factory, coordinator):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    campus = campus_factory("STUDIO")

    _assert_refused(client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, coordinator)))
    # HR_ADMIN holds no MANAGE_CAMPUSES by default -- unchanged, generic refusal.
    hr_response = client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, hr))
    assert hr_response.status_code == 403
    assert hr_response.json()["detail"] != REFUSED
    assert client.delete(f"/api/v1/campuses/{campus.id}", headers=auth_headers(client, admin)).status_code == 204


def test_candidate_delete(client, user_factory, candidate_factory, grant_permission, coordinator):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr = user_factory(UserRoleEnum.HR_ADMIN)
    grant_permission(hr, PermissionEnum.DELETE_CANDIDATE)
    first, second = candidate_factory(), candidate_factory()

    _assert_refused(client.delete(f"/api/v1/candidates/{first.id}", headers=auth_headers(client, coordinator)))
    assert client.delete(f"/api/v1/candidates/{first.id}", headers=auth_headers(client, admin)).status_code == 204
    # An HR Admin explicitly granted DELETE_CANDIDATE keeps it.
    assert client.delete(f"/api/v1/candidates/{second.id}", headers=auth_headers(client, hr)).status_code == 204
