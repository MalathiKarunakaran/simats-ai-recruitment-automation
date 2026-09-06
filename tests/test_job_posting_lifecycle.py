"""Job posting numbers, ad snapshot, content editing, pause/resume, close,
and the three permissions added with them."""

from datetime import date, timedelta

from app.models.audit_log import AuditLog
from app.models.enums import PermissionEnum, UserRoleEnum, VacancyRequestStatusEnum
from app.services.permissions import DEFAULT_PERMISSIONS_BY_ROLE

from tests.conftest import auth_headers


def _url(vacancy) -> str:
    return f"/api/v1/job-postings/{vacancy.job_posting.id}"


def test_publish_numbers_the_requisition_and_posting_and_snapshots_the_ad(client, published_vacancy_factory):
    first = published_vacancy_factory(campus_code="SSE", slot_count=1)
    second = published_vacancy_factory(campus_code="SSE", slot_count=1)
    year = date.today().year

    assert first.approved_vacancy.requisition_number == f"RQ-{year}-000001"
    assert second.approved_vacancy.requisition_number == f"RQ-{year}-000002"
    assert first.job_posting.posting_number == f"JP-{year}-000001"
    assert second.job_posting.posting_number == f"JP-{year}-000002"

    body = client.get(_url(first), headers=auth_headers(client, first.hr_admin)).json()
    assert body["posting_number"] == f"JP-{year}-000001"
    assert body["requisition_number"] == f"RQ-{year}-000001"
    assert body["vacancy_request_id"] == str(first.vacancy_request.id)
    assert body["status"] == "PUBLISHED"
    assert body["is_accepting_applications"] is True
    assert body["ad_title"] == first.vacancy_request.position_title
    # No JD draft on the factory's request, so the templated body was used.
    assert body["ad_body"].startswith(first.vacancy_request.position_title)
    assert "Qualification: Test qualification" in body["ad_body"]


def test_ad_snapshot_wins_over_later_request_edits(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy.vacancy_request.jd_draft = "A draft written after publishing"
    db_session.flush()
    ad = client.get(f"{_url(vacancy)}/ad", headers=auth_headers(client, vacancy.hr_admin)).json()
    assert "Qualification: Test qualification" in ad["body"]
    assert "written after publishing" not in ad["body"]


def test_edit_content_is_audited_and_feeds_the_ad(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    deadline = (date.today() + timedelta(days=30)).isoformat()

    edited = client.patch(
        _url(vacancy), headers=headers,
        json={"ad_title": "Assistant Professor (CSE)", "ad_body": "Join us.", "apply_deadline": deadline,
              "contact_email": "hr@example.com"},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["ad_title"] == "Assistant Professor (CSE)"
    assert body["apply_deadline"] == deadline
    assert body["last_edited_by_id"] == str(vacancy.hr_admin.id)
    assert body["last_edited_at"] is not None

    ad = client.get(f"{_url(vacancy)}/ad", headers=headers).json()
    assert ad["position_title"] == "Assistant Professor (CSE)"
    assert ad["body"] == "Join us."

    audit = db_session.query(AuditLog).filter(AuditLog.action == "JOB_POSTING_UPDATED").one()
    assert audit.before_state["ad_body"] != "Join us."
    assert audit.after_state["ad_body"] == "Join us."

    past = (date.today() - timedelta(days=1)).isoformat()
    assert client.patch(_url(vacancy), headers=headers, json={"apply_deadline": past}).status_code == 400
    assert client.patch(_url(vacancy), headers=headers, json={"contact_email": "not-an-email"}).status_code == 422


def test_past_deadline_stops_accepting_applications_on_read(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy.job_posting.apply_deadline = date.today() - timedelta(days=1)
    db_session.flush()
    body = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin)).json()
    assert body["status"] == "PUBLISHED"
    assert body["is_active"] is True
    assert body["is_accepting_applications"] is False


def test_pause_and_resume(client, published_vacancy_factory, candidate_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    paused = client.post(f"{_url(vacancy)}/pause", headers=headers)
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    assert paused.json()["is_active"] is True  # staff may still record walk-ins
    assert paused.json()["is_accepting_applications"] is False
    assert client.post(f"{_url(vacancy)}/pause", headers=headers).status_code == 409

    candidate = candidate_factory()
    walk_in = client.post(
        "/api/v1/applications", headers=headers,
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert walk_in.status_code == 201, walk_in.text

    resumed = client.post(f"{_url(vacancy)}/resume", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "PUBLISHED"
    assert client.post(f"{_url(vacancy)}/resume", headers=headers).status_code == 409


def test_close_closes_the_vacancy_and_refuses_further_edits(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    closed = client.post(f"{_url(vacancy)}/close", headers=headers)
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["is_active"] is False
    assert closed.json()["closed_at"] is not None
    db_session.refresh(vacancy.vacancy_request)
    assert vacancy.vacancy_request.status == VacancyRequestStatusEnum.CLOSED

    assert client.patch(_url(vacancy), headers=headers, json={"ad_title": "x"}).status_code == 409
    assert client.post(f"{_url(vacancy)}/pause", headers=headers).status_code == 409
    assert client.post(f"{_url(vacancy)}/close", headers=headers).status_code == 409


def test_auto_close_sets_the_posting_status(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(vacancy)
    body = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin)).json()
    assert body["status"] == "CLOSED"
    assert body["is_active"] is False


def test_edit_permission_gates_and_scope(client, published_vacancy_factory, user_factory, grant_permission):
    sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    # HoD: no EDIT_JOB_POSTING by default.
    assert client.patch(_url(sse), headers=auth_headers(client, sse.hod), json={"ad_title": "x"}).status_code == 403
    # Officer of another campus: 404, never 403.
    assert (
        client.patch(_url(scad), headers=auth_headers(client, sse.recruitment_officer), json={"ad_title": "x"})
        .status_code
        == 404
    )
    # A coordinator granted the permission may edit on any campus.
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    assert client.patch(_url(scad), headers=auth_headers(client, coordinator), json={"ad_title": "x"}).status_code == 403
    grant_permission(coordinator, PermissionEnum.EDIT_JOB_POSTING)
    assert client.patch(_url(scad), headers=auth_headers(client, coordinator), json={"ad_title": "x"}).status_code == 200
    # Close needs CLOSE_VACANCY, which EDIT_JOB_POSTING does not confer.
    assert client.post(f"{_url(scad)}/close", headers=auth_headers(client, coordinator)).status_code == 403


def test_review_and_channel_admin_permissions(
    client, published_vacancy_factory, user_factory, grant_permission, recruitment_channel_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    headers = auth_headers(client, coordinator)
    channels_url = f"{_url(vacancy)}/channels"

    # REVIEW_POSTING_CHANNELS alone: may attach and review, may not post or list.
    grant_permission(coordinator, PermissionEnum.REVIEW_POSTING_CHANNELS)
    assert client.post(channels_url, headers=headers, json={"channel_id": str(linkedin.id)}).status_code == 201
    assert client.post(f"{channels_url}/{linkedin.id}/post", headers=headers).status_code == 403
    assert client.get(channels_url, headers=headers).status_code == 403

    # Channel admin needs MANAGE_RECRUITMENT_CHANNELS (or the HR Admin role).
    payload = {"code": "NEWPORTAL", "name": "New", "kind": "JOB_PORTAL", "mode": "API", "integration_path": "x"}
    assert client.post("/api/v1/recruitment-channels", headers=headers, json=payload).status_code == 403
    grant_permission(coordinator, PermissionEnum.MANAGE_RECRUITMENT_CHANNELS)
    assert client.post("/api/v1/recruitment-channels", headers=headers, json=payload).status_code == 201


def test_role_defaults_include_the_new_permissions():
    hr = DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.HR_ADMIN]
    officer = DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.RECRUITMENT_OFFICER]
    assert {
        PermissionEnum.EDIT_JOB_POSTING,
        PermissionEnum.REVIEW_POSTING_CHANNELS,
        PermissionEnum.MANAGE_RECRUITMENT_CHANNELS,
    } <= hr
    assert {PermissionEnum.EDIT_JOB_POSTING, PermissionEnum.REVIEW_POSTING_CHANNELS} <= officer
    assert PermissionEnum.MANAGE_RECRUITMENT_CHANNELS not in officer
