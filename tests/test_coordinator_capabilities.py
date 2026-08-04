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
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    client.put(
        f"/api/v1/users/{coordinator.id}/capabilities",
        headers=auth_headers(client, admin),
        json={"capabilities": ["VACANCY_APPROVAL"]},
    )

    # Granted group: vacancy approval works.
    vacancy = published_vacancy_factory(slot_count=2)
    close_response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close",
        headers=auth_headers(client, coordinator),
    )
    assert close_response.status_code == 200

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
