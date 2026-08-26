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


# --- Starter regulatory-eligibility-rules feature (backend Phase 1) --------


def _full_payload(campus, department, **overrides):
    payload = {
        "campus_id": str(campus.id),
        "department_id": str(department.id),
        "staff_category": "TEACHING",
        "position_title": "Assistant Professor",
        "required_qualification_keyword": "PHD",
        "net_set_required": True,
        "subject": "Computer Science",
        "regulatory_authority": "AICTE_UGC",
        "school_or_college": "School of Computing",
        "programme_discipline": "B.Tech Computer Science and Engineering",
        "minimum_qualification": "PhD in relevant discipline as per AICTE/UGC norms",
        "minimum_percentage": "55% or equivalent CGPA of 6.25/10, relaxable for SC/ST/PWD",
        "required_experience": "0-2 years",
        "required_credential": "NET/SET/SLET or PhD as per UGC 2018 Regulations",
        "required_keywords": "python, machine learning",
        "preferred_keywords": "cloud computing",
        "phd_required": True,
        "professional_registration": None,
        "industry_experience": None,
        "priority": "High",
        "effective_from": "2026-01-01",
        "effective_to": "2030-12-31",
        "source_regulation": "AICTE + applicable UGC rules -- starter regulatory mapping, verify before activation",
        "status": "ACTIVE",
        "verification_required": True,
        "is_active": True,
        "notes": "starter mapping",
    }
    payload.update(overrides)
    return payload


def test_all_new_fields_round_trip_through_create_update_read(client, user_factory, campus_factory, department_factory):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department),
    )
    assert create_response.status_code == 201, create_response.text
    body = create_response.json()

    assert body["department_id"] == str(department.id)
    assert body["regulatory_authority"] == "AICTE_UGC"
    assert body["school_or_college"] == "School of Computing"
    assert body["programme_discipline"] == "B.Tech Computer Science and Engineering"
    assert body["minimum_qualification"].startswith("PhD in relevant discipline")
    assert body["minimum_percentage"].startswith("55%")
    assert body["required_experience"] == "0-2 years"
    assert body["required_credential"].startswith("NET/SET/SLET")
    assert body["required_keywords"] == "python, machine learning"
    assert body["preferred_keywords"] == "cloud computing"
    assert body["phd_required"] is True
    assert body["priority"] == "High"
    assert body["effective_from"] == "2026-01-01"
    assert body["effective_to"] == "2030-12-31"
    assert body["source_regulation"].startswith("AICTE + applicable UGC rules")
    assert body["status"] == "ACTIVE"
    assert body["verification_required"] is True

    rule_id = body["id"]

    get_response = client.get(f"/api/v1/eligibility-rules/{rule_id}", headers=auth_headers(client, hr_admin))
    assert get_response.status_code == 200
    assert get_response.json()["id"] == rule_id
    assert get_response.json()["department_id"] == str(department.id)

    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, hr_admin),
        json={
            "regulatory_authority": "UGC",
            "status": "ARCHIVED",
            "verification_required": False,
            "priority": "Low",
        },
    )
    assert patch_response.status_code == 200, patch_response.text
    patched = patch_response.json()
    assert patched["regulatory_authority"] == "UGC"
    assert patched["status"] == "ARCHIVED"
    assert patched["verification_required"] is False
    assert patched["priority"] == "Low"
    # Untouched fields stay intact.
    assert patched["school_or_college"] == "School of Computing"


def test_status_defaults_to_draft_and_is_independent_of_is_active(client, user_factory, campus_factory):
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
    assert create_response.status_code == 201, create_response.text
    body = create_response.json()
    # status defaults to DRAFT regardless of is_active's own default (True).
    assert body["status"] == "DRAFT"
    assert body["is_active"] is True
    assert body["verification_required"] is True

    rule_id = body["id"]
    # Setting is_active False must not implicitly change status, and vice
    # versa -- the two are deliberately uncoupled.
    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, hr_admin),
        json={"is_active": False},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["status"] == "DRAFT"
    assert patch_response.json()["is_active"] is False


def test_create_rejects_unknown_department_id(client, user_factory, campus_factory):
    import uuid

    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "department_id": str(uuid.uuid4()),
            "staff_category": "TEACHING",
            "required_qualification_keyword": "PHD",
        },
    )
    assert response.status_code == 400
    assert "department_id" in response.json()["detail"]


def test_get_unknown_rule_returns_404(client, user_factory):
    import uuid

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(f"/api/v1/eligibility-rules/{uuid.uuid4()}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 404


# --- Application-level uniqueness (campus, department, position_title,
# regulatory_authority, effective_from) --------------------------------


def test_create_conflicting_natural_key_returns_409(client, user_factory, campus_factory, department_factory):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    payload = _full_payload(sse, department)
    first = client.post("/api/v1/eligibility-rules", headers=auth_headers(client, hr_admin), json=payload)
    assert first.status_code == 201, first.text

    second = client.post("/api/v1/eligibility-rules", headers=auth_headers(client, hr_admin), json=payload)
    assert second.status_code == 409, second.text
    assert "already exists" in second.json()["detail"]


def test_create_same_key_but_different_effective_from_is_allowed(
    client, user_factory, campus_factory, department_factory
):
    """Positive case: a second rule with a different effective_from is a
    legitimate distinct rule, not a conflict."""
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    first = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, effective_from="2026-01-01"),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, effective_from="2027-01-01"),
    )
    assert second.status_code == 201, second.text


def test_create_same_key_but_different_regulatory_authority_is_allowed(
    client, user_factory, campus_factory, department_factory
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    first = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, regulatory_authority="AICTE_UGC"),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, regulatory_authority="UGC"),
    )
    assert second.status_code == 201, second.text


def test_update_into_conflicting_natural_key_returns_409(client, user_factory, campus_factory, department_factory):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    first = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, regulatory_authority="AICTE_UGC"),
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, regulatory_authority="UGC"),
    )
    assert second.status_code == 201
    second_id = second.json()["id"]

    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{second_id}",
        headers=auth_headers(client, hr_admin),
        json={"regulatory_authority": "AICTE_UGC"},
    )
    assert patch_response.status_code == 409, patch_response.text


def test_update_of_unrelated_field_never_triggers_uniqueness_check(
    client, user_factory, campus_factory, department_factory
):
    """A PATCH that doesn't touch any of the 5 natural-key fields must never
    409, even if some other rule happens to share this rule's own key (it
    always does -- itself)."""
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department),
    )
    rule_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/eligibility-rules/{rule_id}",
        headers=auth_headers(client, hr_admin),
        json={"notes": "just a note update"},
    )
    assert patch_response.status_code == 200, patch_response.text


# --- Duplicate endpoint ------------------------------------------------


def test_duplicate_forces_draft_inactive_verification_required(
    client, user_factory, campus_factory, department_factory
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    source_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(
            sse, department, status="ACTIVE", is_active=True, verification_required=False,
        ),
    )
    assert source_response.status_code == 201, source_response.text
    source = source_response.json()

    duplicate_response = client.post(
        f"/api/v1/eligibility-rules/{source['id']}/duplicate",
        headers=auth_headers(client, hr_admin),
    )
    assert duplicate_response.status_code == 201, duplicate_response.text
    duplicate = duplicate_response.json()

    assert duplicate["id"] != source["id"]
    # Forced regardless of the source row's own live values.
    assert duplicate["status"] == "DRAFT"
    assert duplicate["is_active"] is False
    assert duplicate["verification_required"] is True
    # Everything else copied through unchanged.
    assert duplicate["campus_id"] == source["campus_id"]
    assert duplicate["department_id"] == source["department_id"]
    assert duplicate["position_title"] == source["position_title"]
    assert duplicate["regulatory_authority"] == source["regulatory_authority"]
    assert duplicate["effective_from"] == source["effective_from"]
    assert duplicate["required_qualification_keyword"] == source["required_qualification_keyword"]
    assert f"Duplicated from rule {source['id']}" in duplicate["notes"]


def test_duplicate_does_not_run_uniqueness_check(client, user_factory, campus_factory, department_factory):
    """A DRAFT/inactive duplicate is expected to share its source's natural
    key -- the uniqueness check must not block this."""
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    source_response = client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department),
    )
    source_id = source_response.json()["id"]

    duplicate_response = client.post(
        f"/api/v1/eligibility-rules/{source_id}/duplicate", headers=auth_headers(client, hr_admin)
    )
    assert duplicate_response.status_code == 201, duplicate_response.text


def test_duplicate_forbidden_for_non_write_role(client, user_factory, campus_factory):
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
    response = client.post(
        f"/api/v1/eligibility-rules/{rule_id}/duplicate", headers=auth_headers(client, campus_hod)
    )
    assert response.status_code == 403


def test_duplicate_unknown_rule_returns_404(client, user_factory):
    import uuid

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        f"/api/v1/eligibility-rules/{uuid.uuid4()}/duplicate", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 404


# --- Filters -------------------------------------------------------------


def test_list_filters_by_regulatory_authority_department_and_status(
    client, user_factory, campus_factory, department_factory
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    other_department = department_factory("SSE", name="Mechanical", code="MECH")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, regulatory_authority="AICTE_UGC", status="ACTIVE"),
    )
    client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(
            sse, other_department, regulatory_authority="UGC", status="DRAFT", effective_from="2027-01-01"
        ),
    )

    authority_filtered = client.get(
        "/api/v1/eligibility-rules?regulatory_authority=UGC", headers=auth_headers(client, hr_admin)
    )
    assert authority_filtered.status_code == 200
    assert all(item["regulatory_authority"] == "UGC" for item in authority_filtered.json()["items"])
    assert authority_filtered.json()["total"] == 1

    department_filtered = client.get(
        f"/api/v1/eligibility-rules?department_id={department.id}", headers=auth_headers(client, hr_admin)
    )
    assert department_filtered.json()["total"] == 1
    assert department_filtered.json()["items"][0]["department_id"] == str(department.id)

    status_filtered = client.get(
        "/api/v1/eligibility-rules?status=ACTIVE", headers=auth_headers(client, hr_admin)
    )
    assert status_filtered.json()["total"] == 1
    assert status_filtered.json()["items"][0]["status"] == "ACTIVE"


def test_list_search_matches_position_title_and_programme_discipline(
    client, user_factory, campus_factory, department_factory
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department, position_title="Assistant Professor", programme_discipline="Fashion Design"),
    )

    match_by_title = client.get(
        "/api/v1/eligibility-rules?search=Assistant", headers=auth_headers(client, hr_admin)
    )
    assert match_by_title.json()["total"] == 1

    match_by_discipline = client.get(
        "/api/v1/eligibility-rules?search=Fashion", headers=auth_headers(client, hr_admin)
    )
    assert match_by_discipline.json()["total"] == 1

    no_match = client.get(
        "/api/v1/eligibility-rules?search=Nonexistent", headers=auth_headers(client, hr_admin)
    )
    assert no_match.json()["total"] == 0


# --- Export ----------------------------------------------------------------


def test_export_returns_xlsx(client, user_factory, campus_factory, department_factory):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.post(
        "/api/v1/eligibility-rules",
        headers=auth_headers(client, hr_admin),
        json=_full_payload(sse, department),
    )

    response = client.get("/api/v1/eligibility-rules/export", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "simats-eligibility-rules-" in response.headers["content-disposition"]


def test_export_forbidden_for_candidate(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/eligibility-rules/export", headers=auth_headers(client, candidate))
    assert response.status_code == 403
