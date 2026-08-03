import json
from datetime import date, datetime, timedelta, timezone

from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_user_update_creates_audit_log_with_before_after_snapshot(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    target = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    original_full_name = target.full_name  # captured before the PATCH mutates this same ORM instance
    headers = auth_headers(client, admin)

    update = client.patch(
        f"/api/v1/users/{target.id}", headers=headers, json={"full_name": "Updated Name"}
    )
    assert update.status_code == 200

    logs = client.get(
        "/api/v1/audit-logs", headers=headers, params={"entity_type": "User", "actor_user_id": str(admin.id)}
    ).json()["items"]

    matching = [l for l in logs if l["entity_id"] == str(target.id) and l["action"] == "UPDATE"]
    assert len(matching) == 1
    entry = matching[0]
    assert entry["before_state"]["full_name"] == original_full_name
    assert entry["after_state"]["full_name"] == "Updated Name"


def test_login_success_and_failure_create_audit_rows_without_plaintext_password(
    client, user_factory
):
    user = user_factory(UserRoleEnum.SUPER_ADMIN)

    client.post("/api/v1/auth/login", data={"username": user.email, "password": user.plain_password})
    client.post("/api/v1/auth/login", data={"username": user.email, "password": "wrong-one"})

    headers = auth_headers(client, user)
    logs = client.get(
        "/api/v1/audit-logs", headers=headers, params={"actor_user_id": str(user.id)}
    ).json()["items"]

    actions = {l["action"] for l in logs}
    assert "LOGIN_SUCCESS" in actions
    assert "LOGIN_FAILED" in actions

    # No entry should ever contain the raw password anywhere in its serialized state.
    for entry in logs:
        serialized = json.dumps(entry)
        assert user.plain_password not in serialized
        assert "wrong-one" not in serialized


def test_hod_audit_logs_are_scoped_to_own_campus(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    # Generate at least one audit row (a login event) in each campus context.
    client.post(
        "/api/v1/auth/login", data={"username": hod_sse.email, "password": hod_sse.plain_password}
    )
    client.post(
        "/api/v1/auth/login", data={"username": hod_scad.email, "password": hod_scad.plain_password}
    )

    headers = auth_headers(client, hod_sse)
    logs = client.get("/api/v1/audit-logs", headers=headers).json()["items"]

    campus_contexts = {l["campus_context_id"] for l in logs}
    assert campus_contexts == {str(hod_sse.campus_id)}


def test_candidate_cannot_read_audit_logs(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/audit-logs", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_end_date_filter_is_inclusive_of_the_whole_day(client, user_factory):
    # Regression test: end_date used to be compared as a bare midnight
    # instant (created_at <= end_date), which silently excluded every event
    # from later the same day. It must behave like reporting.py's own
    # date-range filters, which treat end_date as inclusive of the full day.
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)
    # AuditLog.created_at is stamped in UTC and the endpoint's start_date/
    # end_date are UTC calendar-day boundaries (audit_logs.py) -- using the
    # local system date here would spuriously fail during the ~5.5h window
    # (IST is UTC+5:30) where local "today" has already ticked over past UTC.
    today = datetime.now(timezone.utc).date()

    client.patch(f"/api/v1/users/{admin.id}", headers=headers, json={"phone_number": "9999999999"})

    logs = client.get(
        "/api/v1/audit-logs",
        headers=headers,
        params={"start_date": today.isoformat(), "end_date": today.isoformat(), "actor_user_id": str(admin.id)},
    ).json()["items"]
    assert any(l["action"] == "UPDATE" and l["entity_id"] == str(admin.id) for l in logs)


def test_start_date_filter_excludes_events_before_it(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)
    tomorrow = date.today() + timedelta(days=1)

    client.patch(f"/api/v1/users/{admin.id}", headers=headers, json={"phone_number": "8888888888"})

    logs = client.get(
        "/api/v1/audit-logs",
        headers=headers,
        params={"start_date": tomorrow.isoformat(), "actor_user_id": str(admin.id)},
    ).json()["items"]
    assert not any(l["entity_id"] == str(admin.id) for l in logs)


def test_audit_logs_rejects_start_after_end_date(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)
    today = date.today()

    response = client.get(
        "/api/v1/audit-logs",
        headers=headers,
        params={"start_date": today.isoformat(), "end_date": (today - timedelta(days=1)).isoformat()},
    )
    assert response.status_code == 422


def test_campus_id_filter_narrows_for_a_global_scope_role(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    client.post("/api/v1/auth/login", data={"username": hod_sse.email, "password": hod_sse.plain_password})
    client.post("/api/v1/auth/login", data={"username": hod_scad.email, "password": hod_scad.plain_password})

    headers = auth_headers(client, admin)
    logs = client.get(
        "/api/v1/audit-logs", headers=headers, params={"campus_id": str(hod_sse.campus_id)}
    ).json()["items"]

    campus_contexts = {l["campus_context_id"] for l in logs}
    assert campus_contexts == {str(hod_sse.campus_id)}
