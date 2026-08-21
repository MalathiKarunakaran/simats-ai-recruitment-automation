from app.models.enums import CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum

from tests.conftest import auth_headers, build_test_pdf


_DEFAULT_RESUME_TEXT = (
    "Experienced software engineer and educator with a PhD in Computer Science. "
    "Ten years of combined industry and academic teaching experience, including "
    "undergraduate and graduate course design, curriculum development, and "
    "published research in distributed systems and machine learning. Proficient "
    "in Python, teaching, mentoring, and research supervision."
)


def _upload_resume(client, candidate_id, actor, text=_DEFAULT_RESUME_TEXT):
    pdf_bytes = build_test_pdf(text)
    return client.post(
        f"/api/v1/candidates/{candidate_id}/resume",
        headers=auth_headers(client, actor),
        files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
    )


def test_upload_resume_rejects_non_pdf(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/resume",
        headers=auth_headers(client, hr_admin),
        files={"file": ("resume.txt", b"not a pdf", "text/plain")},
    )
    assert response.status_code == 400


def test_upload_resume_sets_storage_key(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = _upload_resume(client, candidate.id, hr_admin)
    assert response.status_code == 200
    assert response.json()["resume_storage_key"] == f"{candidate.id}/resume.pdf"


def test_screen_application_without_resume_returns_400(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 400


def test_screen_application_happy_path(
    client, published_vacancy_factory, application_factory, candidate_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory(phone_number="+91 9876543210")
    _upload_resume(client, candidate.id, vacancy.hr_admin)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["overall_recruitment_score"] == 81.0
    assert body["eligibility_score"] == 82.5
    assert body["extracted_skills"] == ["Python", "Teaching", "Research"]
    assert body["is_incomplete_profile"] is False
    assert body["model_version"] == "gpt-4o"

    fetched = client.get(
        f"/api/v1/applications/{application.id}/resume-score", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert fetched.status_code == 200
    assert fetched.json()["overall_recruitment_score"] == 81.0


def test_screen_application_flags_incomplete_profile_for_short_resume(
    client, published_vacancy_factory, application_factory, candidate_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory()
    _upload_resume(client, candidate.id, vacancy.hr_admin, text="")  # blank page -> empty extracted text
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_incomplete_profile"] is True
    assert "RESUME_TEXT_TOO_SHORT" in body["incomplete_reasons"]


def test_screen_application_flags_duplicate_resume(
    client, published_vacancy_factory, application_factory, candidate_factory
):
    vacancy = published_vacancy_factory(slot_count=2)
    shared_text = "Identical resume text shared between two different candidates for duplicate detection."

    candidate_a = candidate_factory()
    _upload_resume(client, candidate_a.id, vacancy.hr_admin, text=shared_text)
    application_a = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_a)
    client.post(f"/api/v1/applications/{application_a.id}/screen", headers=auth_headers(client, vacancy.hr_admin))

    candidate_b = candidate_factory()
    _upload_resume(client, candidate_b.id, vacancy.hr_admin, text=shared_text)
    application_b = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_b)
    response = client.post(
        f"/api/v1/applications/{application_b.id}/screen", headers=auth_headers(client, vacancy.hr_admin)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_duplicate"] is True
    assert body["duplicate_of_candidate_id"] == str(candidate_a.id)


def test_screen_application_ai_error_maps_to_503_on_rate_limit(
    client, published_vacancy_factory, application_factory, candidate_factory, fake_openai_client
):
    import httpx
    import openai

    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory()
    _upload_resume(client, candidate.id, vacancy.hr_admin)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    def _raise_rate_limit(**kwargs):
        req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        resp = httpx.Response(429, request=req)
        raise openai.RateLimitError("rate limited", response=resp, body=None)

    fake_openai_client.chat.completions.create = _raise_rate_limit

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 503


def test_recruitment_coordinator_without_grant_forbidden_to_screen_application(
    client, published_vacancy_factory, application_factory, candidate_factory, user_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    candidate = candidate_factory(phone_number="+91 9876543210")
    _upload_resume(client, candidate.id, vacancy.hr_admin)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, coordinator)
    )
    assert response.status_code == 403


def test_recruitment_coordinator_with_grant_can_screen_application(
    client,
    published_vacancy_factory,
    application_factory,
    candidate_factory,
    user_factory,
    grant_coordinator_capability,
    grant_permission,
):
    # Both grants inserted directly -- CoordinatorCapabilityGrant (still
    # real) plus the UserPermissionGrant this endpoint actually checks now
    # (require_permission(RESUME_SCREENING)), mirroring what a real
    # coordinator would have post-migration-backfill (e5a4d57be056 maps
    # JOB_DISTRIBUTION_SCREENING onto JOB_DISTRIBUTION/RESUME_SCREENING) --
    # the test DB never runs that migration, so both are inserted directly.
    vacancy = published_vacancy_factory(slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.JOB_DISTRIBUTION_SCREENING)
    grant_permission(coordinator, PermissionEnum.RESUME_SCREENING)
    candidate = candidate_factory(phone_number="+91 9876543210")
    _upload_resume(client, candidate.id, vacancy.hr_admin)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, coordinator)
    )
    assert response.status_code == 200


def test_recruitment_officer_cannot_screen_other_campus_application(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    officer_scad = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCAD")

    response = client.post(
        f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, officer_scad)
    )
    assert response.status_code == 404


def test_candidate_ranking_orders_by_overall_score(
    client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    from app.models.resume_score import ResumeScore

    vacancy = published_vacancy_factory(slot_count=3)
    app_low = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_factory())
    app_high = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_factory())
    app_unscored = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_factory())

    db_session.add(ResumeScore(application_id=app_low.id, overall_recruitment_score=40.0))
    db_session.add(ResumeScore(application_id=app_high.id, overall_recruitment_score=95.0))
    db_session.flush()

    response = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/candidate-ranking",
        headers=auth_headers(client, vacancy.hr_admin),
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 3
    application_ids_in_order = [item["application_id"] for item in items]
    # Highest score first, then lower score, unscored (NULL) last.
    assert application_ids_in_order[0] == str(app_high.id)
    assert application_ids_in_order[1] == str(app_low.id)
    assert application_ids_in_order[2] == str(app_unscored.id)
    assert items[2]["overall_recruitment_score"] is None


def test_candidate_ranking_is_campus_scoped(client, published_vacancy_factory, application_factory, user_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application_factory(vacancy_sse.job_posting, recorded_by=vacancy_sse.hr_admin)
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    same_campus = client.get(
        f"/api/v1/job-postings/{vacancy_sse.job_posting.id}/candidate-ranking",
        headers=auth_headers(client, vacancy_sse.hod),
    )
    assert same_campus.status_code == 200

    other_campus = client.get(
        f"/api/v1/job-postings/{vacancy_sse.job_posting.id}/candidate-ranking",
        headers=auth_headers(client, hod_scad),
    )
    assert other_campus.status_code == 404
