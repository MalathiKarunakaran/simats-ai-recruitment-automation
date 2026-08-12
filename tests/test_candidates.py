from app.models.enums import ApplicationStatusEnum, CoordinatorCapabilityEnum, HiringSlotStatusEnum, UserRoleEnum
from app.models.hiring_slot import HiringSlot

from tests.conftest import auth_headers, build_test_pdf


def test_download_resume_returns_404_when_none_uploaded(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.get(f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, hr_admin))
    assert response.status_code == 404


def test_download_resume_returns_404_for_unknown_candidate(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(
        "/api/v1/candidates/00000000-0000-0000-0000-000000000000/resume", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 404


def test_download_resume_happy_path(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()
    pdf_bytes = build_test_pdf("Resume content for download test.")

    upload = client.post(
        f"/api/v1/candidates/{candidate.id}/resume",
        headers=auth_headers(client, hr_admin),
        files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 200

    response = client.get(f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_download_resume_forbidden_for_candidate_role(client, user_factory, candidate_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    candidate = candidate_factory()

    response = client.get(
        f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, candidate_user)
    )
    assert response.status_code == 403


def _transition_application(client, application_id, actor, new_status, reason=None):
    body = {"status": new_status}
    if reason is not None:
        body["reason"] = reason
    return client.patch(
        f"/api/v1/applications/{application_id}/status", headers=auth_headers(client, actor), json=body
    )


def test_withdraw_candidate_success(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Candidate no longer interested"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_withdrawn"] is True
    assert body["withdrawn_at"] is not None
    assert body["withdrawn_reason"] == "Candidate no longer interested"


def test_withdraw_already_withdrawn_candidate_returns_409(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    first = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "First withdrawal"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Second attempt"},
    )
    assert second.status_code == 409
    assert "already withdrawn" in second.json()["detail"]


def test_withdraw_candidate_empty_reason_returns_422(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": ""},
    )
    assert response.status_code == 422


def test_recruitment_coordinator_without_grant_forbidden_to_create_candidate(client, user_factory):
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    create = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, coordinator),
        json={"full_name": "Coordinator Created Candidate", "email": "coord.created@example.com"},
    )
    assert create.status_code == 403


def test_recruitment_coordinator_with_grant_can_create_and_withdraw_candidate(
    client, user_factory, grant_coordinator_capability
):
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.CANDIDATES_APPLICATIONS)

    create = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, coordinator),
        json={"full_name": "Coordinator Created Candidate", "email": "coord.created@example.com"},
    )
    assert create.status_code == 201
    candidate_id = create.json()["id"]

    withdraw = client.post(
        f"/api/v1/candidates/{candidate_id}/withdraw",
        headers=auth_headers(client, coordinator),
        json={"reason": "Created by coordinator RBAC test"},
    )
    assert withdraw.status_code == 200
    assert withdraw.json()["is_withdrawn"] is True


def test_withdraw_candidate_forbidden_for_non_write_role(client, user_factory, candidate_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    candidate = candidate_factory()

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hod),
        json={"reason": "Should be forbidden"},
    )
    assert response.status_code == 403


def test_withdraw_candidate_cascades_to_selected_application_and_releases_slot(
    client, user_factory, candidate_factory, published_vacancy_factory, application_factory, db_session
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory()
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Candidate withdrew from process"},
    )
    assert response.status_code == 200

    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.WITHDRAWN

    slot = db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id).one()
    assert slot.status == HiringSlotStatusEnum.OPEN
    assert slot.reserved_application_id is None


def test_withdraw_candidate_skips_terminal_application(
    client, user_factory, candidate_factory, published_vacancy_factory, application_factory, db_session
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory()
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    assert _transition_application(
        client, application.id, vacancy.hr_admin, "REJECTED", reason="Not a fit"
    ).status_code == 200

    response = client.post(
        f"/api/v1/candidates/{candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Candidate withdrew from process"},
    )
    assert response.status_code == 200

    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.REJECTED
    assert application.rejection_reason == "Not a fit"


def test_update_candidate_success(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory(full_name="Original Name", phone_number="9000000000")

    response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        headers=auth_headers(client, hr_admin),
        json={"full_name": "Updated Name", "phone_number": "9111111111"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] == "Updated Name"
    assert body["phone_number"] == "9111111111"
    # Untouched field survives a partial patch.
    assert body["email"] == candidate.email


def test_update_candidate_forbidden_for_non_write_role(client, user_factory, candidate_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    candidate = candidate_factory()

    response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        headers=auth_headers(client, hod),
        json={"full_name": "Should Be Forbidden"},
    )
    assert response.status_code == 403


def test_update_candidate_returns_404_for_unknown_candidate(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.patch(
        "/api/v1/candidates/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(client, hr_admin),
        json={"full_name": "Nobody"},
    )
    assert response.status_code == 404


def test_update_candidate_duplicate_email_returns_409(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    existing = candidate_factory(email="taken@example.com")
    candidate = candidate_factory()

    response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        headers=auth_headers(client, hr_admin),
        json={"email": existing.email},
    )
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_update_candidate_switching_to_reference_source_requires_reference_name(
    client, user_factory, candidate_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        headers=auth_headers(client, hr_admin),
        json={"source": "Reference"},
    )
    assert response.status_code == 400
    assert "reference_name" in response.json()["detail"]


def test_update_candidate_source_and_reference_name_together_succeeds(
    client, user_factory, candidate_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        headers=auth_headers(client, hr_admin),
        json={"source": "Reference", "reference_name": "Jane Referrer"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "Reference"
    assert body["reference_name"] == "Jane Referrer"


def test_list_candidates_is_withdrawn_filter(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    withdrawn_candidate = candidate_factory()
    active_candidate = candidate_factory()

    client.post(
        f"/api/v1/candidates/{withdrawn_candidate.id}/withdraw",
        headers=auth_headers(client, hr_admin),
        json={"reason": "No longer interested"},
    )

    withdrawn_response = client.get(
        "/api/v1/candidates", headers=auth_headers(client, hr_admin), params={"is_withdrawn": "true"}
    )
    assert withdrawn_response.status_code == 200
    withdrawn_ids = {item["id"] for item in withdrawn_response.json()["items"]}
    assert str(withdrawn_candidate.id) in withdrawn_ids
    assert str(active_candidate.id) not in withdrawn_ids

    active_response = client.get(
        "/api/v1/candidates", headers=auth_headers(client, hr_admin), params={"is_withdrawn": "false"}
    )
    assert active_response.status_code == 200
    active_ids = {item["id"] for item in active_response.json()["items"]}
    assert str(active_candidate.id) in active_ids
    assert str(withdrawn_candidate.id) not in active_ids
