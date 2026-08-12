from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_hr_admin_can_create_and_read_eligibility_rule(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["campus_id"] == str(sse.id)
    assert body["staff_category"] == "TEACHING"
    assert body["position_title"] is None
    assert body["required_qualification_keyword"] == "PHD"
    assert body["is_active"] is True

    listing = client.get("/api/v1/eligibility-rules", headers=auth_headers(client, hr_admin))
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1


def test_super_admin_can_patch_eligibility_rule(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, super_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
            "notes": "initial",
        },
    )
    assert create_response.status_code == 201
    rule_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, super_admin),
        json={"is_active": False, "notes": "disabled for testing"},
    )
    assert patch_response.status_code == 200, patch_response.text
    body = patch_response.json()
    assert body["is_active"] is False
    assert body["notes"] == "disabled for testing"


def test_non_admin_write_roles_are_forbidden(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, recruitment_officer),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    assert create_response.status_code == 403


def test_non_admin_write_role_cannot_patch(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    rule_id = create_response.json()["id"]

    campus_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, campus_hod),
        json={"is_active": False},
    )
    assert patch_response.status_code == 403


def test_any_staff_role_can_read_but_candidate_cannot(client, user_factory):
    campus_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/eligibility-rules", headers=auth_headers(client, campus_hod))
    assert response.status_code == 200

    candidate = user_factory(UserRoleEnum.CANDIDATE)
    candidate_response = client.get("/api/v1/eligibility-rules", headers=auth_headers(client, candidate))
    assert candidate_response.status_code == 403


def test_category_specific_optional_fields_round_trip(client, user_factory, campus_factory):
    # Phase 5 -- net_set_required/subject (Teaching), skills_keyword
    # (Non-Teaching), id_proof_required/shift_preference (Housekeeping) are
    # all optional and accepted/returned regardless of a row's own
    # staff_category.
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "NON_TEACHING",
            "required_qualification_keyword": "SKILLS",
            "skills_keyword": "Excel",
            "id_proof_required": True,
            "shift_preference": "Night",
        },
    )
    assert create_response.status_code == 201, create_response.text
    body = create_response.json()
    assert body["skills_keyword"] == "Excel"
    assert body["id_proof_required"] is True
    assert body["shift_preference"] == "Night"
    assert body["net_set_required"] is None
    assert body["subject"] is None

    rule_id = body["id"]
    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, hr_admin),
        json={"net_set_required": True, "subject": "Physics"},
    )
    assert patch_response.status_code == 200, patch_response.text
    patched = patch_response.json()
    assert patched["net_set_required"] is True
    assert patched["subject"] == "Physics"
    # Fields set at creation stay intact after an unrelated patch.
    assert patched["skills_keyword"] == "Excel"


def test_super_admin_can_delete_eligibility_rule(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, super_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    rule_id = create_response.json()["id"]

    response = client.delete(
        f"/api/v1/eligibility-rules/{rule_id}", headers=auth_headers(client, super_admin)
    )
    assert response.status_code == 204

    listing = client.get("/api/v1/eligibility-rules", headers=auth_headers(client, super_admin))
    match = next(item for item in listing.json()["items"] if item["id"] == rule_id)
    assert match["is_active"] is False


def test_non_admin_write_role_cannot_delete_eligibility_rule(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    rule_id = create_response.json()["id"]

    campus_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.delete(
        f"/api/v1/eligibility-rules/{rule_id}", headers=auth_headers(client, campus_hod)
    )
    assert response.status_code == 403


def test_delete_unknown_eligibility_rule_returns_404(client, user_factory):
    import uuid

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.delete(
        f"/api/v1/eligibility-rules/{uuid.uuid4()}", headers=auth_headers(client, super_admin)
    )
    assert response.status_code == 404
