"""Admin CRUD for recruitment channels and channel rules."""

import uuid

from app.models.audit_log import AuditLog
from app.models.enums import RecruitmentChannelModeEnum, StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers


def _channel_payload(**overrides) -> dict:
    payload = {
        "code": "TESTPORTAL",
        "name": "Test Portal",
        "kind": "JOB_PORTAL",
        "mode": "API",
        "integration_path": "job-distribution",
        "applicable_categories": ["TEACHING"],
    }
    payload.update(overrides)
    return payload


def test_hr_admin_creates_lists_and_updates_a_channel(client, user_factory, db_session):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, hr_admin)

    created = client.post("/api/v1/recruitment-channels", headers=headers, json=_channel_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["code"] == "TESTPORTAL"
    assert body["is_active"] is True
    assert body["applicable_categories"] == ["TEACHING"]

    listed = client.get("/api/v1/recruitment-channels", headers=headers)
    assert listed.status_code == 200
    assert [c["code"] for c in listed.json()["items"]] == ["TESTPORTAL"]

    # Category filter: "empty = all" plus explicit membership.
    assert client.get("/api/v1/recruitment-channels?category=TEACHING", headers=headers).json()["total"] == 1
    assert client.get("/api/v1/recruitment-channels?category=HOUSEKEEPING", headers=headers).json()["total"] == 0

    updated = client.patch(
        f"/api/v1/recruitment-channels/{body['id']}", headers=headers, json={"is_active": False, "name": "Renamed"}
    )
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False
    assert updated.json()["name"] == "Renamed"
    assert updated.json()["code"] == "TESTPORTAL"

    actions = [
        row.action
        for row in db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "RecruitmentChannel", AuditLog.entity_id == uuid.UUID(body["id"]))
        .all()
    ]
    assert actions == ["CREATE", "UPDATE"]


def test_channel_code_is_unique_and_validated(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, hr_admin)
    assert client.post("/api/v1/recruitment-channels", headers=headers, json=_channel_payload()).status_code == 201
    assert client.post("/api/v1/recruitment-channels", headers=headers, json=_channel_payload()).status_code == 409
    assert (
        client.post("/api/v1/recruitment-channels", headers=headers, json=_channel_payload(code="bad code")).status_code
        == 422
    )


def test_integration_path_rules(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, hr_admin)
    # A full URL is refused: N8N_BASE_URL is the one place the host lives.
    absolute = client.post(
        "/api/v1/recruitment-channels", headers=headers,
        json=_channel_payload(integration_path="https://evil.example/hook"),
    )
    assert absolute.status_code == 422
    # A manual channel has nothing to call.
    manual = client.post(
        "/api/v1/recruitment-channels", headers=headers,
        json=_channel_payload(code="BOARD", mode="MANUAL_ASSISTED", integration_path="job-distribution"),
    )
    assert manual.status_code == 400
    ok = client.post(
        "/api/v1/recruitment-channels", headers=headers,
        json=_channel_payload(code="BOARD", mode="MANUAL_ASSISTED", integration_path=None),
    )
    assert ok.status_code == 201


def test_unknown_campus_id_is_rejected(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/recruitment-channels", headers=auth_headers(client, hr_admin),
        json=_channel_payload(applicable_campus_ids=[str(uuid.uuid4())]),
    )
    assert response.status_code == 400


def test_channel_writes_are_admin_only_but_reads_are_staff_wide(client, user_factory, recruitment_channel_factory):
    recruitment_channel_factory("LINKEDIN")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    assert client.get("/api/v1/recruitment-channels", headers=auth_headers(client, officer)).status_code == 200
    assert client.get("/api/v1/recruitment-channels", headers=auth_headers(client, hod)).status_code == 200
    assert client.get("/api/v1/recruitment-channels", headers=auth_headers(client, candidate)).status_code == 403
    assert (
        client.post("/api/v1/recruitment-channels", headers=auth_headers(client, officer), json=_channel_payload())
        .status_code
        == 403
    )


def test_rules_crud_and_validation(client, user_factory, recruitment_channel_factory, department_factory, campus_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, hr_admin)
    linkedin = recruitment_channel_factory("LINKEDIN")
    board = recruitment_channel_factory("BOARD", mode=RecruitmentChannelModeEnum.MANUAL_ASSISTED)
    sse = campus_factory("SSE")
    scad_department = department_factory("SCAD")

    created = client.post(
        "/api/v1/channel-rules", headers=headers,
        json={
            "name": "Teaching goes to LinkedIn",
            "match_category": "TEACHING",
            "channel_ids": [str(linkedin.id), str(board.id)],
            "priority": 200,
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]
    assert created.json()["auto_select"] is False

    # Unknown channel, empty channel list, department not on the campus.
    assert (
        client.post(
            "/api/v1/channel-rules", headers=headers, json={"name": "x", "channel_ids": [str(uuid.uuid4())]}
        ).status_code
        == 400
    )
    assert client.post("/api/v1/channel-rules", headers=headers, json={"name": "x", "channel_ids": []}).status_code == 422
    assert (
        client.post(
            "/api/v1/channel-rules", headers=headers,
            json={
                "name": "x", "channel_ids": [str(linkedin.id)],
                "match_campus_id": str(sse.id), "match_department_id": str(scad_department.id),
            },
        ).status_code
        == 400
    )

    updated = client.patch(f"/api/v1/channel-rules/{rule_id}", headers=headers, json={"auto_select": True})
    assert updated.status_code == 200
    assert updated.json()["auto_select"] is True

    listed = client.get("/api/v1/channel-rules", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["match_category"] == StaffRoleCategoryEnum.TEACHING.value

    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    assert (
        client.patch(f"/api/v1/channel-rules/{rule_id}", headers=auth_headers(client, officer), json={"priority": 1})
        .status_code
        == 403
    )
