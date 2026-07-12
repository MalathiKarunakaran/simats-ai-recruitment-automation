import json

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
