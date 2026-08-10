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


def test_skills_mismatch_non_teaching_application_at_disallowed_campus_is_flagged(
    client, published_vacancy_factory, candidate_factory
):
    # Mirrors test_phd_teaching_application_at_disallowed_campus_is_flagged
    # for the NON_TEACHING branch of check_qualification_mismatch -- see
    # app/services/eligibility.py::_check_non_teaching.
    vacancy = published_vacancy_factory(
        campus_code="SCAD",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.NON_TEACHING,
        qualification="Advanced Excel skills certification required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is True
    assert body["qualification_mismatch_reason"] is not None
    assert "SCAD" in body["qualification_mismatch_reason"]
    assert "Non-Teaching" in body["qualification_mismatch_reason"]


def test_skills_non_teaching_application_at_allowlisted_campus_is_not_flagged(
    client, published_vacancy_factory, candidate_factory, user_factory, campus_factory
):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    rule_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "NON_TEACHING",
            "required_qualification_keyword": "SKILLS",
            "skills_keyword": "Excel",
        },
    )
    assert rule_response.status_code == 201

    vacancy = published_vacancy_factory(
        campus_code="SSE",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.NON_TEACHING,
        qualification="Advanced Excel skills certification required",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is False
    assert body["qualification_mismatch_reason"] is None


def test_id_proof_housekeeping_application_at_disallowed_campus_is_flagged(
    client, published_vacancy_factory, candidate_factory
):
    # Mirrors test_phd_teaching_application_at_disallowed_campus_is_flagged
    # for the HOUSEKEEPING branch of check_qualification_mismatch -- see
    # app/services/eligibility.py::_check_housekeeping.
    vacancy = published_vacancy_factory(
        campus_code="SCAD",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.HOUSEKEEPING,
        qualification="Aadhaar ID proof verification required before joining",
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["qualification_mismatch"] is True
    assert body["qualification_mismatch_reason"] is not None
    assert "SCAD" in body["qualification_mismatch_reason"]
    assert "Housekeeping" in body["qualification_mismatch_reason"]


def test_id_proof_housekeeping_application_at_allowlisted_campus_is_not_flagged(
    client, published_vacancy_factory, candidate_factory, user_factory, campus_factory
):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    rule_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "HOUSEKEEPING",
            "required_qualification_keyword": "ID_PROOF",
            "id_proof_required": True,
            "shift_preference": "Night",
        },
    )
    assert rule_response.status_code == 201

    vacancy = published_vacancy_factory(
        campus_code="SSE",
        slot_count=1,
        role_category=StaffRoleCategoryEnum.HOUSEKEEPING,
        qualification="Aadhaar ID proof verification required before joining",
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


def test_application_role_category_denormalized_from_job_posting(
    client, published_vacancy_factory, candidate_factory
):
    # create_application() sets Application.role_category =
    # job_posting.role_category at creation time (Phase 1 staff-category
    # migrations) -- verify it's both persisted and exposed on the read
    # schema, for a non-default (HOUSEKEEPING) category.
    vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.HOUSEKEEPING
    )
    candidate = candidate_factory()

    response = _create_application(client, vacancy, candidate)
    assert response.status_code == 201, response.text
    assert response.json()["role_category"] == "HOUSEKEEPING"


def test_pipeline_details_with_salary_fixed_round_trips_and_can_be_re_edited(
    client, published_vacancy_factory, candidate_factory
):
    # Regression test: Application.salary_fixed is a Numeric column that
    # SQLAlchemy returns as decimal.Decimal once reloaded from the DB
    # (contradicting its Mapped[float | None] type hint) -- the
    # pipeline-details PATCH's audit-log `before` snapshot reads it straight
    # off the freshly-loaded ORM object into a dict destined for JSON
    # storage, which crashed with "Object of type Decimal is not JSON
    # serializable" on the second edit, before the column was declared
    # asdecimal=False (same bug class as VacancyRequest.salary_band_min).
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    candidate = candidate_factory()
    application_id = _create_application(client, vacancy, candidate).json()["id"]

    first = client.patch(
        f"/api/v1/applications/{application_id}/pipeline-details",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"salary_fixed": 60000},
    )
    assert first.status_code == 200, first.text
    assert first.json()["salary_fixed"] == 60000

    second = client.patch(
        f"/api/v1/applications/{application_id}/pipeline-details",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"salary_fixed": 65000},
    )
    assert second.status_code == 200, second.text
    assert second.json()["salary_fixed"] == 65000
