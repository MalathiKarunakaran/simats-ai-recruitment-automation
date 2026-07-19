from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers


def _create_application(client, vacancy, candidate):
    return client.post(
        "/api/v1/applications",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )


def test_phd_teaching_application_at_disallowed_campus_is_flagged(
    client, published_vacancy_factory, candidate_factory
):
    vacancy = published_vacancy_factory(
        campus_code="SCAD",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD in Computer Science required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is True
    assert body["qualification_mismatch_reason"] is not None
    assert "SCAD" in body["qualification_mismatch_reason"]


def test_phd_teaching_application_at_allowlisted_campus_is_not_flagged(
    client, published_vacancy_factory, candidate_factory, user_factory, campus_factory
):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    rule_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    assert rule_response.status_code == 201

    vacancy = published_vacancy_factory(
        campus_code="SSE",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD in Computer Science required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is False
    assert body["qualification_mismatch_reason"] is None


def test_non_teaching_phd_text_is_not_flagged(client, published_vacancy_factory, candidate_factory):
    vacancy = published_vacancy_factory(
        campus_code="SCAD",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.NON_TEACHING,
        qualification="PhD preferred but not required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is False
    assert body["qualification_mismatch_reason"] is None


def test_inactive_rule_is_treated_as_absent(
    client, published_vacancy_factory, candidate_factory, user_factory, campus_factory
):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    rule_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    assert rule_response.status_code == 201
    rule_id = rule_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, hr_admin),
        json={"is_active": False},
    )
    assert patch_response.status_code == 200

    vacancy = published_vacancy_factory(
        campus_code="SSE",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD in Computer Science required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is True
    assert body["qualification_mismatch_reason"] is not None
