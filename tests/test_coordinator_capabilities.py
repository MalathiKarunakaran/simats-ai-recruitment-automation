from app.models.enums import CoordinatorCapabilityEnum, UserRoleEnum

from tests.conftest import auth_headers


def test_super_admin_can_grant_capabilities_via_put(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    response = client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL", "INTERVIEWS"]},
    )
    assert response.status_code == 200
    assert sorted(response.json()["capabilities"]) == ["INTERVIEWS", "VACANCY_APPROVAL"]

    read_back = client.get(
        f"/api/v1/users/{coordinator.id}/capabilities", headers=auth_headers(client, admin)
    )
    assert read_back.status_code == 200
    assert sorted(read_back.json()["capabilities"]) == ["INTERVIEWS", "VACANCY_APPROVAL"]


def test_put_capabilities_is_a_full_replace_not_additive(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL", "INTERVIEWS"]},
    )

    second = client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["CANDIDATES_APPLICATIONS"]},
    )
    assert second.status_code == 200
    assert second.json()["capabilities"] == ["CANDIDATES_APPLICATIONS"]


def test_put_capabilities_to_empty_list_revokes_all(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL"]},
    )
    revoked = client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": []},
    )
    assert revoked.status_code == 200
    assert revoked.json()["capabilities"] == []


def test_put_capabilities_forbidden_for_non_super_admin(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    response = client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, hr_admin),
        json={"capabilities": ["VACANCY_APPROVAL"]},
    )
    assert response.status_code == 403


def test_put_capabilities_400_for_non_coordinator_target(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.put(
        f"/api/v1/users/{hr_admin.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL"]},
    )
    assert response.status_code == 400


def test_coordinator_can_read_own_capabilities(client, user_factory, grant_coordinator_capability):
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.INTERVIEWS)

    response = client.get(
        f"/api/v1/users/{coordinator.id}/capabilities", headers=auth_headers(client, coordinator)
    )
    assert response.status_code == 200
    assert response.json()["capabilities"] == ["INTERVIEWS"]


def test_coordinator_cannot_read_another_users_capabilities(client, user_factory, grant_coordinator_capability):
    coordinator_a = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    coordinator_b = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    grant_coordinator_capability(coordinator_b, CoordinatorCapabilityEnum.INTERVIEWS)

    response = client.get(
        f"/api/v1/users/{coordinator_b.id}/capabilities", headers=auth_headers(client, coordinator_a)
    )
    assert response.status_code == 403


def test_fresh_coordinator_user_starts_with_zero_capabilities(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    create = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "fresh.coordinator@example.com",
            "password": "SomePass123!",
            "full_name": "Fresh Coordinator",
            "role": "RECRUITMENT_COORDINATOR",
        },
    )
    assert create.status_code == 201
    coordinator_id = create.json()["id"]

    response = client.get(
        f"/api/v1/users/{coordinator_id}/capabilities", headers=auth_headers(client, admin)
    )
    assert response.status_code == 200
    assert response.json()["capabilities"] == []


def test_granting_one_capability_allows_only_that_action_group(
    client, user_factory, department_factory, published_vacancy_factory
):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL"]},
    )

    # Granted group: vacancy approval works -- exercised via hr-approve
    # specifically (not close/reject/publish/cancel, which Phase 2 of the
    # permission-matrix epic cut over to require_permission() and which a
    # bare CoordinatorCapabilityGrant with no matching UserPermissionGrant
    # no longer satisfies -- see vacancy_requests.py's own module notes).
    # hr-approve (and dean-approve/adjust-slot-count) were deliberately left
    # on the old require_roles_or_coordinator_capability gate, so this is
    # still the right endpoint to prove a bare capability grant works.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    create = client.post(
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
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))

    hr_approve_response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve",
        headers=auth_headers(client, coordinator),
    )
    assert hr_approve_response.status_code == 200

    vacancy = published_vacancy_factory(slot_count=2)

    # Ungranted groups: everything else still 403s.
    candidate_response = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, coordinator),
        json={"full_name": "Should Fail", "email": "should.fail@example.com"},
    )
    assert candidate_response.status_code == 403

    interview_response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, coordinator),
        json={
            "application_id": "00000000-0000-0000-0000-000000000000",
            "interview_type": "TECHNICAL",
            "scheduled_at": "2026-09-01T10:00:00Z",
        },
    )
    assert interview_response.status_code == 403

    distribute_response = client.post(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
        headers=auth_headers(client, coordinator),
        json={"portals": ["LINKEDIN"]},
    )
    assert distribute_response.status_code == 403
