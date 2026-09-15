"""The job posting review workflow (2026-09-15).

Publishing a vacancy creates a DRAFT posting. Its content is edited by hand
or drafted by AI, submitted, approved and published; publishing posts the
careers page by itself, while manual and integration channels are posted
per channel. Nothing unconfigured reports success, and one channel failing
never fails the posting or another channel.
"""

from datetime import date, timedelta

import httpx
import openai

from app.core.config import settings
from app.main import app
from app.models.audit_log import AuditLog
from app.models.enums import PermissionEnum, RecruitmentChannelModeEnum, UserRoleEnum
from app.services.ai_client import get_jd_ai_client
from app.services.n8n_client import get_n8n_client
from app.services.permissions import DEFAULT_PERMISSIONS_BY_ROLE

from tests.conftest import FakeN8nClient, FakeOpenAIClient, auth_headers

INTERNAL = RecruitmentChannelModeEnum.INTERNAL
MANUAL = RecruitmentChannelModeEnum.MANUAL_ASSISTED


def _url(vacancy, suffix: str = "") -> str:
    return f"/api/v1/job-postings/{vacancy.job_posting.id}{suffix}"


def _public(slug: str) -> str:
    return f"/api/v1/public/careers/postings/{slug}"


def _channels(client, vacancy, user) -> dict[str, dict]:
    response = client.get(_url(vacancy, "/channels"), headers=auth_headers(client, user))
    assert response.status_code == 200, response.text
    return {row["channel_code"]: row for row in response.json()["items"]}


def _audit(db_session, posting_id, action: str):
    return (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "JobPosting", AuditLog.entity_id == posting_id, AuditLog.action == action)
        .all()
    )


# --- Creation ---------------------------------------------------------------


def test_publishing_a_vacancy_creates_a_draft_that_is_not_public(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2, live=False)
    body = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin)).json()

    assert body["status"] == "DRAFT"
    assert body["is_active"] is False
    assert body["published_at"] is None
    assert body["is_accepting_applications"] is False
    assert body["created_by_name"] == vacancy.hr_admin.full_name
    # Content copied from the approved request.
    assert body["ad_title"] == vacancy.vacancy_request.position_title
    assert body["required_qualification"] == "Test qualification"
    assert body["required_experience"] == "Test experience"
    assert body["employment_type"] == "FULL_TIME"
    # Detail facts read through the request's master data.
    assert body["campus_code"] == "SSE"
    assert body["department_name"] == vacancy.department.name
    assert body["priority"] == "NORMAL"

    slug = vacancy.job_posting.public_apply_slug
    assert client.get(_public(slug)).status_code == 404
    listed = client.get("/api/v1/public/careers/postings").json()["items"]
    assert slug not in {posting["public_apply_slug"] for posting in listed}


# --- Review and publication -------------------------------------------------


def test_review_workflow_takes_a_draft_live_with_an_audit_trail(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, db_session
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    faculty = recruitment_channel_factory("FACULTYPLUS", mode=MANUAL)
    channel_rule_factory("Careers", [careers], auto_select=True)
    channel_rule_factory("Teaching", [faculty], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)
    officer = auth_headers(client, vacancy.recruitment_officer)

    assert client.post(_url(vacancy, "/approve"), headers=hr).status_code == 409  # still a draft

    submitted = client.post(_url(vacancy, "/submit-for-review"), headers=officer)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "READY_FOR_REVIEW"
    assert submitted.json()["submitted_for_review_by_name"] == vacancy.recruitment_officer.full_name

    assert client.post(_url(vacancy, "/publish"), headers=officer).status_code == 409  # not approved yet
    assert client.post(_url(vacancy, "/approve"), headers=officer).status_code == 403  # officers do not approve

    approved = client.post(_url(vacancy, "/approve"), headers=hr)
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approved_by_name"] == vacancy.hr_admin.full_name
    assert approved.json()["is_active"] is False

    published = client.post(_url(vacancy, "/publish"), headers=officer)
    assert published.status_code == 200, published.text
    body = published.json()
    assert body["status"] == "PUBLISHED"
    assert body["is_active"] is True
    assert body["published_at"] is not None
    assert body["published_by_name"] == vacancy.recruitment_officer.full_name
    assert body["is_accepting_applications"] is True

    slug = vacancy.job_posting.public_apply_slug
    assert client.get(_public(slug)).status_code == 200

    rows = _channels(client, vacancy, vacancy.hr_admin)
    assert rows["CAREERS_PAGE"]["status"] == "POSTED"
    assert rows["CAREERS_PAGE"]["external_url"].endswith(f"/careers/{slug}")
    # Publishing never posts a channel a person has to post.
    assert rows["FACULTYPLUS"]["status"] == "SELECTED"

    for action in ("JOB_POSTING_CREATED", "JOB_POSTING_SUBMITTED_FOR_REVIEW", "JOB_POSTING_APPROVED", "JOB_POSTING_PUBLISHED"):
        assert len(_audit(db_session, vacancy.job_posting.id, action)) == 1, action


def test_editing_a_posting_under_review_returns_it_to_draft(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)
    assert client.post(_url(vacancy, "/submit-for-review"), headers=hr).status_code == 200
    assert client.post(_url(vacancy, "/approve"), headers=hr).status_code == 200

    edited = client.patch(_url(vacancy), headers=hr, json={"summary": "Changed after approval"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["status"] == "DRAFT"
    assert edited.json()["approved_by_id"] is None
    assert edited.json()["summary"] == "Changed after approval"
    (audit,) = _audit(db_session, vacancy.job_posting.id, "JOB_POSTING_UPDATED")
    assert audit.after_state["returned_to_draft"] is True


def test_return_to_draft_records_the_reason(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)
    assert client.post(_url(vacancy, "/submit-for-review"), headers=hr).status_code == 200

    returned = client.post(_url(vacancy, "/return-to-draft"), headers=hr, json={"reason": "Add the salary range"})
    assert returned.status_code == 200
    assert returned.json()["status"] == "DRAFT"
    (audit,) = _audit(db_session, vacancy.job_posting.id, "JOB_POSTING_RETURNED_TO_DRAFT")
    assert audit.after_state["reason"] == "Add the salary range"
    # Nothing to return once it is a draft again.
    assert client.post(_url(vacancy, "/return-to-draft"), headers=hr, json={}).status_code == 409


def test_a_draft_cannot_be_paused_or_resumed(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)
    assert client.post(_url(vacancy, "/pause"), headers=hr).status_code == 409
    assert client.post(_url(vacancy, "/resume"), headers=hr).status_code == 409


# --- Content, permissions, positions ------------------------------------------


def test_content_is_edited_only_by_authorized_users_and_validated(
    client, published_vacancy_factory, location_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2, live=False)
    hod = auth_headers(client, vacancy.hod)
    hr = auth_headers(client, vacancy.hr_admin)

    # A HoD holds none of the posting permissions.
    assert client.patch(_url(vacancy), headers=hod, json={"summary": "x"}).status_code == 403
    for action in ("/generate-content", "/submit-for-review", "/approve", "/publish"):
        assert client.post(_url(vacancy, action), headers=hod).status_code == 403, action

    assert client.patch(_url(vacancy), headers=hr, json={"salary_min": 50000, "salary_max": 10000}).status_code == 422
    elsewhere = location_factory("SCAD")
    assert client.patch(_url(vacancy), headers=hr, json={"location_id": str(elsewhere.id)}).status_code == 400

    here = location_factory("SSE", name="Main Block", block_building="Block A")
    edited = client.patch(
        _url(vacancy),
        headers=hr,
        json={
            "location_id": str(here.id),
            "required_skills": [" Python ", "", "Teaching"],
            "preferred_skills": ["Research"],
            "responsibilities": "- Teach undergraduate courses",
            "salary_min": 40000,
            "salary_max": 60000,
        },
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["location_label"] == "Main Block, Block A"
    assert body["required_skills"] == ["Python", "Teaching"]
    assert body["preferred_skills"] == ["Research"]
    assert (body["salary_min"], body["salary_max"]) == (40000, 60000)
    # Counts are derived, never written.
    assert (body["positions_requested"], body["positions_filled"], body["positions_remaining"]) == (2, 0, 2)


def test_positions_filled_and_remaining_follow_hires(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    hired_employee_factory(vacancy)
    body = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin)).json()
    assert (body["positions_requested"], body["positions_filled"], body["positions_remaining"]) == (2, 1, 1)


def test_role_defaults_for_the_review_permissions():
    hr = DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.HR_ADMIN]
    officer = DEFAULT_PERMISSIONS_BY_ROLE[UserRoleEnum.RECRUITMENT_OFFICER]
    assert {PermissionEnum.APPROVE_JOB_POSTING, PermissionEnum.PUBLISH_JOB_POSTING} <= hr
    assert PermissionEnum.PUBLISH_JOB_POSTING in officer
    assert PermissionEnum.APPROVE_JOB_POSTING not in officer
    for role in (UserRoleEnum.CAMPUS_HOD, UserRoleEnum.RECRUITMENT_COORDINATOR, UserRoleEnum.MANAGEMENT):
        assert PermissionEnum.APPROVE_JOB_POSTING not in DEFAULT_PERMISSIONS_BY_ROLE[role]


# --- AI draft ----------------------------------------------------------------


def test_ai_writes_an_editable_draft_and_never_touches_the_requirements(
    client, published_vacancy_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)

    generated = client.post(
        _url(vacancy, "/generate-content"), headers=hr, json={"additional_instructions": "Mention the labs"}
    )
    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["status"] == "DRAFT"
    assert body["summary"] == "Test role overview for a faculty position."
    assert "- Teach undergraduate courses." in body["responsibilities"]
    assert "Role Overview" in body["ad_body"]
    assert body["ai_generated_at"] is not None
    assert body["required_qualification"] == "Test qualification"
    (audit,) = _audit(db_session, vacancy.job_posting.id, "JOB_POSTING_CONTENT_GENERATED")
    assert audit.after_state["ai_provider"] == settings.jd_ai_provider

    # Still a person's text: it can be edited like any other.
    assert client.patch(_url(vacancy), headers=hr, json={"summary": "Edited by HR"}).json()["summary"] == "Edited by HR"


def test_ai_only_drafts_a_draft(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)  # live
    response = client.post(_url(vacancy, "/generate-content"), headers=auth_headers(client, vacancy.hr_admin), json={})
    assert response.status_code == 409


def test_ai_failure_or_absence_does_not_break_the_posting(client, published_vacancy_factory, monkeypatch):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    hr = auth_headers(client, vacancy.hr_admin)
    before = client.get(_url(vacancy), headers=hr).json()

    def _unreachable(kwargs):
        raise openai.APIConnectionError(request=httpx.Request("POST", "https://ai.example"))

    app.dependency_overrides[get_jd_ai_client] = lambda: FakeOpenAIClient(response_provider=_unreachable)
    failed = client.post(_url(vacancy, "/generate-content"), headers=hr, json={})
    assert failed.status_code == 502
    after = client.get(_url(vacancy), headers=hr).json()
    assert (after["ad_body"], after["summary"], after["ai_generated_at"]) == (before["ad_body"], None, None)

    # Not configured at all: a clear 503 up front, and the status endpoint says so.
    app.dependency_overrides.pop(get_jd_ai_client)
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai", raising=False)
    monkeypatch.setattr(settings, "JD_AI_PROVIDER", "", raising=False)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "", raising=False)
    not_configured = client.post(_url(vacancy, "/generate-content"), headers=hr, json={})
    assert not_configured.status_code == 503
    assert "not configured" in not_configured.json()["detail"]
    status = client.get("/api/v1/job-postings/content-generation/status", headers=hr).json()
    assert status["configured"] is False
    assert "OPENAI_API_KEY" in status["message"]

    # The posting itself carries on without AI.
    assert client.post(_url(vacancy, "/submit-for-review"), headers=hr).status_code == 200


def test_jd_provider_setting_falls_back_to_the_main_provider(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai", raising=False)
    monkeypatch.setattr(settings, "JD_AI_PROVIDER", "", raising=False)
    assert settings.jd_ai_provider == "openai"
    monkeypatch.setattr(settings, "JD_AI_PROVIDER", "Ollama", raising=False)
    assert settings.jd_ai_provider == "ollama"
    assert settings.model_for("ollama") == settings.OLLAMA_MODEL


# --- Channels ------------------------------------------------------------------


def test_channel_reads_say_how_each_channel_is_posted(client, recruitment_channel_factory, user_factory):
    recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    recruitment_channel_factory("FACULTYPLUS", mode=MANUAL)
    recruitment_channel_factory("PORTAL")  # API, and no n8n host in tests
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, hr_admin)

    channels = {c["code"]: c for c in client.get("/api/v1/recruitment-channels", headers=headers).json()["items"]}
    assert channels["CAREERS_PAGE"]["configuration_status"] == "AUTOMATIC"
    assert channels["FACULTYPLUS"]["configuration_status"] == "MANUAL"
    assert channels["PORTAL"]["configuration_status"] == "NOT_CONFIGURED"
    assert "not configured" in channels["PORTAL"]["configuration_message"]

    bad = {"code": "BOARD", "name": "Board", "kind": "INTERNAL", "mode": "MANUAL_ASSISTED", "config": {"posting_url": "board.example"}}
    assert client.post("/api/v1/recruitment-channels", headers=headers, json=bad).status_code == 422


def test_manual_channel_workflow_records_the_reference_and_date(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, db_session
):
    faculty = recruitment_channel_factory("FACULTYPLUS", mode=MANUAL)
    faculty.config = {"posting_url": "https://employer.facultyplus.example/post"}
    db_session.flush()
    channel_rule_factory("Teaching", [faculty], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hr = auth_headers(client, vacancy.hr_admin)
    url = _url(vacancy, f"/channels/{faculty.id}")

    row = _channels(client, vacancy, vacancy.hr_admin)["FACULTYPLUS"]
    assert row["channel_configuration_status"] == "MANUAL"
    assert row["channel_posting_url"] == "https://employer.facultyplus.example/post"

    queued = client.post(f"{url}/post", headers=hr)
    assert queued.status_code == 200
    assert queued.json()["channel"]["status"] == "QUEUED"  # shown as "Manual action required"

    assert client.post(f"{url}/manual-posting", headers=hr, json={"external_url": "facultyplus.example/ad/9"}).status_code == 422
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert client.post(f"{url}/manual-posting", headers=hr, json={"external_ref": "FP-9", "posted_on": tomorrow}).status_code == 422

    posted_on = date.today() - timedelta(days=2)
    recorded = client.post(
        f"{url}/manual-posting",
        headers=hr,
        json={"external_ref": "FP-9", "external_url": "https://facultyplus.example/ad/9", "posted_on": posted_on.isoformat()},
    )
    assert recorded.status_code == 200, recorded.text
    body = recorded.json()
    assert body["status"] == "POSTED"
    assert body["external_ref"] == "FP-9"
    assert body["posted_at"].startswith(posted_on.isoformat())
    assert db_session.query(AuditLog).filter(AuditLog.action == "JOB_POSTING_CHANNEL_POSTED_MANUALLY").count() == 1


def test_one_failed_channel_does_not_fail_the_posting_or_other_channels(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=INTERNAL)
    portal = recruitment_channel_factory("PORTAL")
    channel_rule_factory("Both", [careers, portal], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hr = auth_headers(client, vacancy.hr_admin)

    app.dependency_overrides[get_n8n_client] = lambda: FakeN8nClient(raises=httpx.ConnectError("portal down"))
    try:
        failed = client.post(_url(vacancy, f"/channels/{portal.id}/post"), headers=hr)
    finally:
        app.dependency_overrides.pop(get_n8n_client, None)
    assert failed.status_code == 200
    assert failed.json()["attempt"]["outcome"] == "FAILED"

    rows = _channels(client, vacancy, vacancy.hr_admin)
    assert rows["PORTAL"]["status"] == "FAILED"
    assert rows["CAREERS_PAGE"]["status"] == "POSTED"
    posting = client.get(_url(vacancy), headers=hr).json()
    assert (posting["status"], posting["is_active"]) == ("PUBLISHED", True)

    history = client.get(_url(vacancy, "/posting-history"), headers=hr).json()["items"]
    assert {(item["channel_code"], item["outcome"]) for item in history} == {
        ("CAREERS_PAGE", "SUCCEEDED"),
        ("PORTAL", "FAILED"),
    }


# --- Close, reopen, compatibility ------------------------------------------------


def test_closing_a_posting_updates_its_status_and_is_audited(client, published_vacancy_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    closed = client.post(_url(vacancy, "/close"), headers=auth_headers(client, vacancy.hr_admin))
    assert closed.status_code == 200, closed.text
    assert (closed.json()["status"], closed.json()["is_active"]) == ("CLOSED", False)
    assert closed.json()["closed_at"] is not None
    (audit,) = _audit(db_session, vacancy.job_posting.id, "JOB_POSTING_CLOSED")
    assert audit.before_state["status"] == "PUBLISHED"
    assert audit.after_state["status"] == "CLOSED"


def test_reopening_a_vacancy_closed_during_drafting_returns_the_draft(client, published_vacancy_factory, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    headers = auth_headers(client, super_admin)
    request_url = f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}"

    assert client.post(f"{request_url}/close", headers=headers).status_code == 200
    assert client.get(_url(vacancy), headers=headers).json()["status"] == "CLOSED"
    assert client.post(f"{request_url}/reopen", headers=headers).status_code == 200

    body = client.get(_url(vacancy), headers=headers).json()
    assert (body["status"], body["is_active"], body["published_at"]) == ("DRAFT", False, None)


def test_a_pre_review_posting_without_the_new_fields_still_reads_and_edits(
    client, published_vacancy_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    posting = vacancy.job_posting
    # What migration e8f9a0b1c2d3 can leave on an existing row: no trail
    # users it could attribute, and no structured content.
    for field in (
        "created_by_id", "submitted_for_review_by_id", "approved_by_id", "published_by_id", "summary",
        "responsibilities", "required_qualification", "required_experience", "required_skills",
        "preferred_skills", "employment_type", "location_id", "salary_min", "salary_max",
    ):
        setattr(posting, field, None)
    db_session.flush()
    hr = auth_headers(client, vacancy.hr_admin)

    listed = {item["id"]: item for item in client.get("/api/v1/job-postings", headers=hr).json()["items"]}
    item = listed[str(posting.id)]
    assert (item["status"], item["created_by_name"], item["employment_type"]) == ("PUBLISHED", None, None)
    assert client.get(_public(posting.public_apply_slug)).status_code == 200

    # A live posting stays live when its text is corrected.
    edited = client.patch(_url(vacancy), headers=hr, json={"ad_title": "Still editable"})
    assert edited.status_code == 200
    assert edited.json()["status"] == "PUBLISHED"
