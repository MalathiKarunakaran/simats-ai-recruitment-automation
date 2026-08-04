from app.models.enums import CoordinatorCapabilityEnum, UserRoleEnum

from tests.conftest import auth_headers


def test_recruitment_officer_cannot_record_application_for_other_campus_posting(
    client, published_vacancy_factory, candidate_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    officer_scad = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCAD")
    candidate = candidate_factory()

    response = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, officer_scad),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert response.status_code == 403


def test_recruitment_officer_can_record_application_for_own_campus_posting(
    client, published_vacancy_factory, candidate_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    candidate = candidate_factory()

    response = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "APPLIED"


def test_recruitment_coordinator_without_grant_forbidden_to_record_application(
    client, published_vacancy_factory, candidate_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    candidate = candidate_factory()

    response = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, coordinator),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert response.status_code == 403


def test_recruitment_coordinator_with_grant_can_record_application_for_any_campus_posting(
    client, published_vacancy_factory, candidate_factory, user_factory, grant_coordinator_capability
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.CANDIDATES_APPLICATIONS)
    candidate = candidate_factory()

    response = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, coordinator),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "APPLIED"


def test_candidate_role_blocked_from_applications_endpoints(client, user_factory, published_vacancy_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)

    response = client.get("/api/v1/applications", headers=auth_headers(client, candidate_user))
    assert response.status_code == 403


def test_candidate_role_blocked_from_vacancy_requests(client, user_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, candidate_user))
    assert response.status_code == 403


def test_management_has_read_only_global_access(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application_factory(vacancy_sse.job_posting, recorded_by=vacancy_sse.hr_admin)
    application_factory(vacancy_scad.job_posting, recorded_by=vacancy_scad.hr_admin)
    management = user_factory(UserRoleEnum.MANAGEMENT)

    listing = client.get("/api/v1/applications", headers=auth_headers(client, management))
    assert listing.status_code == 200
    assert listing.json()["total"] == 2

    write_attempt = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, management),
        json={
            "campus_id": str(vacancy_sse.campus.id),
            "department_id": str(vacancy_sse.department.id),
            "role_category": "TEACHING",
            "position_title": "X",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "X",
            "experience_required": "X",
        },
    )
    assert write_attempt.status_code == 403


def test_applications_list_scoped_by_campus_for_hod(
    client, published_vacancy_factory, application_factory
):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application_factory(vacancy_sse.job_posting, recorded_by=vacancy_sse.hr_admin)
    application_factory(vacancy_scad.job_posting, recorded_by=vacancy_scad.hr_admin)

    response = client.get("/api/v1/applications", headers=auth_headers(client, vacancy_sse.hod))
    assert response.status_code == 200
    assert response.json()["total"] == 1
