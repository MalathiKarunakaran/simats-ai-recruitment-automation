"""Posting channels: rule recommendation at publish, recruiter review,
posting attempts by mode, retries, manual references, the legacy distribute
endpoint over channel rows, and retirement on close."""

import httpx

from app.models.audit_log import AuditLog
from app.models.enums import (
    MAX_POSTING_ATTEMPTS_PER_CHANNEL,
    RecruitmentChannelModeEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.job_posting_channel import JobPostingChannel, PostingAttempt
from app.services.n8n_client import get_n8n_client, get_n8n_client_or_503

from tests.conftest import FakeN8nClient, auth_headers


def _channels_url(vacancy) -> str:
    return f"/api/v1/job-postings/{vacancy.job_posting.id}/channels"


def _rows_by_code(client, vacancy, user) -> dict[str, dict]:
    response = client.get(_channels_url(vacancy), headers=auth_headers(client, user))
    assert response.status_code == 200, response.text
    return {row["channel_code"]: row for row in response.json()["items"]}


def _override_n8n(client_obj):
    from app.main import app

    app.dependency_overrides[get_n8n_client] = lambda: client_obj
    app.dependency_overrides[get_n8n_client_or_503] = lambda: client_obj


def _clear_n8n():
    from app.main import app

    app.dependency_overrides.pop(get_n8n_client, None)
    app.dependency_overrides.pop(get_n8n_client_or_503, None)


# --- Recommendation at publish ---------------------------------------------


def test_publish_recommends_channels_from_rules(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    board = recruitment_channel_factory("BOARD", mode=RecruitmentChannelModeEnum.MANUAL_ASSISTED)
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=RecruitmentChannelModeEnum.INTERNAL)
    channel_rule_factory("Careers page for every posting", [careers], auto_select=True)
    channel_rule_factory("Teaching posts", [linkedin, board], match_category=StaffRoleCategoryEnum.TEACHING)

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)

    assert rows["CAREERS_PAGE"]["status"] == "SELECTED"
    assert rows["CAREERS_PAGE"]["recommendation_reason"] == "Careers page for every posting"
    assert rows["LINKEDIN"]["status"] == "RECOMMENDED"
    assert rows["BOARD"]["status"] == "RECOMMENDED"
    assert all(row["recommended_by"] == "RULE" for row in rows.values())


def test_more_specific_rule_decides_and_rerun_is_idempotent(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Everything", [linkedin])
    channel_rule_factory("Teaching auto", [linkedin], auto_select=True, match_category=StaffRoleCategoryEnum.TEACHING)

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)
    assert rows["LINKEDIN"]["status"] == "SELECTED"
    assert rows["LINKEDIN"]["recommendation_reason"] == "Teaching auto"

    rerun = client.post(f"{_channels_url(vacancy)}/recommend", headers=auth_headers(client, vacancy.hr_admin))
    assert rerun.status_code == 200
    assert rerun.json()["created"] == []
    assert len(_rows_by_code(client, vacancy, vacancy.hr_admin)) == 1


def test_inactive_and_non_applicable_channels_are_skipped(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    retired = recruitment_channel_factory("RETIRED", is_active=False)
    housekeeping_only = recruitment_channel_factory(
        "LOCAL", applicable_categories=[StaffRoleCategoryEnum.HOUSEKEEPING]
    )
    non_matching = recruitment_channel_factory("NONTEACH")
    channel_rule_factory("All", [retired, housekeeping_only])
    channel_rule_factory("Non-teaching only", [non_matching], match_category=StaffRoleCategoryEnum.NON_TEACHING)

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    assert _rows_by_code(client, vacancy, vacancy.hr_admin) == {}


# --- Review and posting ------------------------------------------------------


def test_select_then_post_api_channel_records_attempt(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, db_session
):
    linkedin = recruitment_channel_factory("LINKEDIN", integration_path="linkedin-post")
    channel_rule_factory("Teaching", [linkedin], match_category=StaffRoleCategoryEnum.TEACHING)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"{_channels_url(vacancy)}/{linkedin.id}"

    # Posting a merely RECOMMENDED channel is refused.
    assert client.post(f"{url}/post", headers=headers).status_code == 409

    reviewed = client.patch(url, headers=headers, json={"decision": "SELECT"})
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "SELECTED"
    assert reviewed.json()["reviewed_by_id"] == str(vacancy.hr_admin.id)

    fake = FakeN8nClient()
    _override_n8n(fake)
    try:
        posted = client.post(f"{url}/post", headers=headers)
    finally:
        _clear_n8n()
    assert posted.status_code == 200, posted.text
    body = posted.json()
    assert body["channel"]["status"] == "POSTED"
    assert body["channel"]["attempt_count"] == 1
    assert body["attempt"]["outcome"] == "SUCCEEDED"
    assert body["attempt"]["trigger"] == "MANUAL"
    assert body["channel"]["last_attempt_id"] == body["attempt"]["id"]

    path, payload = fake.calls[0]
    assert path == "linkedin-post"
    assert payload["channel_code"] == "LINKEDIN"
    assert payload["portals"] == ["LINKEDIN"]
    assert payload["job_posting_id"] == str(vacancy.job_posting.id)

    attempts = client.get(f"{url}/attempts", headers=headers)
    assert attempts.status_code == 200
    assert [a["attempt_number"] for a in attempts.json()["items"]] == [1]

    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "POSTING_ATTEMPT_SUCCEEDED", AuditLog.entity_type == "JobPostingChannel")
        .one()
    )
    assert audit.after_state["channel_code"] == "LINKEDIN"


def test_unconfigured_n8n_records_not_configured_then_retry_succeeds(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Auto", [linkedin], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"{_channels_url(vacancy)}/{linkedin.id}"

    first = client.post(f"{url}/post", headers=headers)  # N8N_BASE_URL is unset in tests
    assert first.status_code == 200
    assert first.json()["attempt"]["outcome"] == "NOT_CONFIGURED"
    assert first.json()["channel"]["status"] == "FAILED"
    assert "N8N_BASE_URL" in first.json()["channel"]["last_error"]

    _override_n8n(FakeN8nClient())
    try:
        second = client.post(f"{url}/post", headers=headers)
    finally:
        _clear_n8n()
    assert second.status_code == 200
    assert second.json()["attempt"]["attempt_number"] == 2
    assert second.json()["attempt"]["trigger"] == "RETRY"
    assert second.json()["channel"]["status"] == "POSTED"
    assert second.json()["channel"]["last_error"] is None


def test_webhook_failure_and_timeout_are_recorded_not_raised(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Auto", [linkedin], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"{_channels_url(vacancy)}/{linkedin.id}"

    _override_n8n(FakeN8nClient(raises=httpx.ConnectError("boom")))
    try:
        failed = client.post(f"{url}/post", headers=headers)
    finally:
        _clear_n8n()
    assert failed.status_code == 200
    assert failed.json()["attempt"]["outcome"] == "FAILED"
    assert "boom" in failed.json()["attempt"]["error_message"]

    _override_n8n(FakeN8nClient(raises=httpx.ReadTimeout("slow")))
    try:
        timed_out = client.post(f"{url}/post", headers=headers)
    finally:
        _clear_n8n()
    assert timed_out.json()["attempt"]["outcome"] == "TIMEOUT"
    assert timed_out.json()["channel"]["status"] == "FAILED"
    assert timed_out.json()["channel"]["attempt_count"] == 2


def test_retry_cap_blocks_further_attempts(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, db_session
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Auto", [linkedin], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    row = db_session.query(JobPostingChannel).filter_by(job_posting_id=vacancy.job_posting.id).one()
    row.attempt_count = MAX_POSTING_ATTEMPTS_PER_CHANNEL
    db_session.flush()

    response = client.post(
        f"{_channels_url(vacancy)}/{linkedin.id}/post", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 409
    assert "fix the integration" in response.json()["detail"]


def test_manual_assisted_channel_queues_then_reference_marks_posted(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    board = recruitment_channel_factory("FACULTYPLUS", mode=RecruitmentChannelModeEnum.MANUAL_ASSISTED)
    channel_rule_factory("Auto", [board], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"{_channels_url(vacancy)}/{board.id}"

    queued = client.post(f"{url}/post", headers=headers)
    assert queued.status_code == 200
    assert queued.json()["channel"]["status"] == "QUEUED"
    assert queued.json()["attempt"]["outcome"] == "SUCCEEDED"

    assert client.post(f"{url}/manual-posting", headers=headers, json={}).status_code == 422
    recorded = client.post(
        f"{url}/manual-posting", headers=headers, json={"external_url": "https://facultyplus.example/ad/123"}
    )
    assert recorded.status_code == 200
    assert recorded.json()["status"] == "POSTED"
    assert recorded.json()["external_url"] == "https://facultyplus.example/ad/123"
    assert recorded.json()["attempt_count"] == 2


def test_internal_channel_posts_immediately(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=RecruitmentChannelModeEnum.INTERNAL)
    channel_rule_factory("Careers", [careers], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.post(
        f"{_channels_url(vacancy)}/{careers.id}/post", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["channel"]["status"] == "POSTED"
    assert response.json()["channel"]["posted_at"] is not None


def test_attach_duplicate_remove_and_reattach(
    client, published_vacancy_factory, recruitment_channel_factory
):
    naukri = recruitment_channel_factory("NAUKRI")
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    attached = client.post(_channels_url(vacancy), headers=headers, json={"channel_id": str(naukri.id)})
    assert attached.status_code == 201, attached.text
    assert attached.json()["status"] == "SELECTED"
    assert attached.json()["recommended_by"] == "USER"

    assert client.post(_channels_url(vacancy), headers=headers, json={"channel_id": str(naukri.id)}).status_code == 409

    removed = client.patch(f"{_channels_url(vacancy)}/{naukri.id}", headers=headers, json={"decision": "REMOVE"})
    assert removed.status_code == 200
    assert removed.json()["status"] == "REMOVED"
    assert removed.json()["removed_at"] is not None
    # Selecting a REMOVED row is not the path back; attaching is.
    assert (
        client.patch(f"{_channels_url(vacancy)}/{naukri.id}", headers=headers, json={"decision": "SELECT"}).status_code
        == 409
    )
    revived = client.post(_channels_url(vacancy), headers=headers, json={"channel_id": str(naukri.id)})
    assert revived.status_code == 201
    assert revived.json()["status"] == "SELECTED"
    assert revived.json()["removed_at"] is None


# --- Legacy distribute endpoint over channel rows ----------------------------


def test_legacy_distribute_creates_rows_and_one_attempt_each(
    client, published_vacancy_factory, recruitment_channel_factory, db_session
):
    recruitment_channel_factory("LINKEDIN")
    recruitment_channel_factory("INDEED")
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    fake = FakeN8nClient()
    _override_n8n(fake)
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"portals": ["LINKEDIN", "INDEED"]},
        )
    finally:
        _clear_n8n()
    assert response.status_code == 200, response.text
    assert response.json()["portals"] == ["LINKEDIN", "INDEED"]
    assert len(fake.calls) == 1  # one webhook call, as before
    assert fake.calls[0][1]["portals"] == ["LINKEDIN", "INDEED"]

    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)
    assert {code: row["status"] for code, row in rows.items()} == {"LINKEDIN": "POSTED", "INDEED": "POSTED"}
    attempts = db_session.query(PostingAttempt).all()
    assert len(attempts) == 2
    assert {a.trigger.value for a in attempts} == {"LEGACY_DISTRIBUTE"}


def test_legacy_distribute_failure_persists_attempts_and_returns_502(
    client, published_vacancy_factory, recruitment_channel_factory, db_session
):
    recruitment_channel_factory("LINKEDIN")
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _override_n8n(FakeN8nClient(raises=httpx.ConnectError("down")))
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"portals": ["LINKEDIN"]},
        )
    finally:
        _clear_n8n()
    assert response.status_code == 502

    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)
    assert rows["LINKEDIN"]["status"] == "FAILED"
    assert rows["LINKEDIN"]["attempt_count"] == 1
    assert db_session.query(PostingAttempt).filter_by(outcome="FAILED").count() == 1
    assert (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "JOB_POSTING_DISTRIBUTE_FAILED", AuditLog.entity_id == vacancy.job_posting.id)
        .count()
        == 1
    )


def test_legacy_distribute_only_accepts_active_api_channels(
    client, published_vacancy_factory, recruitment_channel_factory
):
    recruitment_channel_factory("LINKEDIN")
    recruitment_channel_factory("BOARD", mode=RecruitmentChannelModeEnum.MANUAL_ASSISTED)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _override_n8n(FakeN8nClient())
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"portals": ["BOARD"]},
        )
    finally:
        _clear_n8n()
    assert response.status_code == 400
    assert "Supported: LINKEDIN" in response.json()["detail"]


# --- Close / retire ----------------------------------------------------------


def test_closing_the_vacancy_retires_live_channel_rows(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, db_session
):
    careers = recruitment_channel_factory("CAREERS_PAGE", mode=RecruitmentChannelModeEnum.INTERNAL)
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Both", [careers, linkedin], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    assert client.post(f"{_channels_url(vacancy)}/{careers.id}/post", headers=headers).status_code == 200

    closed = client.post(f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=headers)
    assert closed.status_code == 200, closed.text

    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)
    assert {code: row["status"] for code, row in rows.items()} == {"CAREERS_PAGE": "REMOVED", "LINKEDIN": "REMOVED"}
    assert all(row["removed_at"] is not None for row in rows.values())
    retired = db_session.query(AuditLog).filter(AuditLog.action == "JOB_POSTING_CHANNELS_RETIRED").one()
    assert retired.after_state["count"] == 2

    # Nothing can be attached or posted to a closed posting.
    assert client.post(_channels_url(vacancy), headers=headers, json={"channel_id": str(linkedin.id)}).status_code == 409


def test_auto_close_on_last_hire_retires_channel_rows(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory, hired_employee_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Auto", [linkedin], auto_select=True)
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(vacancy)  # fills the only slot -> auto-close
    rows = _rows_by_code(client, vacancy, vacancy.hr_admin)
    assert rows["LINKEDIN"]["status"] == "REMOVED"


# --- RBAC and scope ----------------------------------------------------------


def test_channel_endpoints_follow_distribution_permission_and_campus_scope(
    client, published_vacancy_factory, recruitment_channel_factory, channel_rule_factory
):
    linkedin = recruitment_channel_factory("LINKEDIN")
    channel_rule_factory("Auto", [linkedin], auto_select=True)
    sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    # A campus HoD holds no JOB_DISTRIBUTION grant.
    assert client.get(_channels_url(sse), headers=auth_headers(client, sse.hod)).status_code == 403
    # An SSE officer cannot even see that the SCAD posting's channels exist.
    assert client.get(_channels_url(scad), headers=auth_headers(client, sse.recruitment_officer)).status_code == 404
    assert client.get(_channels_url(sse), headers=auth_headers(client, sse.recruitment_officer)).status_code == 200
