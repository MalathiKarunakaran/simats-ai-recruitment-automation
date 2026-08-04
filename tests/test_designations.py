from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def _payload(**overrides):
    payload = {
        "name": "Assistant Professor",
        "category": "TEACHING",
        "qualification": "PhD in relevant field",
        "min_experience": "3+ years",
        "employment_type": "FULL_TIME",
    }
    payload.update(overrides)
    return payload


def test_super_admin_can_create_and_list_designation(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.post(
        "/api/v1/designations", headers=auth_headers(client, super_admin), json=_payload()
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Assistant Professor"
    assert body["category"] == "TEACHING"
    assert body["employment_type"] == "FULL_TIME"
    assert body["department_ids"] == []
    assert body["is_active"] is True

    listing = client.get("/api/v1/designations", headers=auth_headers(client, super_admin))
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1


def test_recruitment_coordinator_can_create_designation_with_departments(
    client, user_factory, department_factory
):
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    department = department_factory("SSE", "Computer Science")

    response = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, coordinator),
        json=_payload(department_ids=[str(department.id)]),
    )
    assert response.status_code == 201, response.text
    assert response.json()["department_ids"] == [str(department.id)]


def test_designation_create_rejects_unknown_department_id(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    import uuid

    response = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(department_ids=[str(uuid.uuid4())]),
    )
    assert response.status_code == 400


def test_hr_admin_cannot_create_designation(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/designations", headers=auth_headers(client, hr_admin), json=_payload()
    )
    assert response.status_code == 403


def test_recruitment_officer_cannot_create_designation(client, user_factory):
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.post(
        "/api/v1/designations", headers=auth_headers(client, officer), json=_payload()
    )
    assert response.status_code == 403


def test_super_admin_can_patch_designation(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    create_response = client.post(
        "/api/v1/designations", headers=auth_headers(client, super_admin), json=_payload()
    )
    designation_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/designations/{designation_id}",
        headers=auth_headers(client, super_admin),
        json={"is_active": False, "employment_type": "ADJUNCT"},
    )
    assert patch_response.status_code == 200, patch_response.text
    body = patch_response.json()
    assert body["is_active"] is False
    assert body["employment_type"] == "ADJUNCT"


def test_hr_admin_cannot_patch_designation(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    create_response = client.post(
        "/api/v1/designations", headers=auth_headers(client, super_admin), json=_payload()
    )
    designation_id = create_response.json()["id"]

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    patch_response = client.patch(
        f"/api/v1/designations/{designation_id}",
        headers=auth_headers(client, hr_admin),
        json={"is_active": False},
    )
    assert patch_response.status_code == 403


def test_candidate_cannot_list_designations(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/designations", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_list_designations_filters_by_department_and_category(client, user_factory, department_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    cse_dept = department_factory("SSE", "Computer Science")
    other_dept = department_factory("SSE", "Mechanical Engineering")

    matching = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Professor of CSE", department_ids=[str(cse_dept.id)]),
    )
    assert matching.status_code == 201

    non_matching = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Non-Teaching Clerk", category="NON_TEACHING", department_ids=[str(other_dept.id)]),
    )
    assert non_matching.status_code == 201

    filtered = client.get(
        f"/api/v1/designations?department_id={cse_dept.id}", headers=auth_headers(client, super_admin)
    )
    assert filtered.status_code == 200
    names = {item["name"] for item in filtered.json()["items"]}
    assert "Professor of CSE" in names
    assert "Non-Teaching Clerk" not in names

    category_filtered = client.get(
        "/api/v1/designations?category=NON_TEACHING", headers=auth_headers(client, super_admin)
    )
    names = {item["name"] for item in category_filtered.json()["items"]}
    assert "Non-Teaching Clerk" in names
    assert "Professor of CSE" not in names
