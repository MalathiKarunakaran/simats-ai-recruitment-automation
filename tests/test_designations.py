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


def test_category_counts_reflect_full_set_regardless_of_selected_category(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    teaching = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Counts Teaching Designation", category="TEACHING"),
    )
    assert teaching.status_code == 201
    non_teaching_1 = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Counts NonTeaching Designation 1", category="NON_TEACHING"),
    )
    assert non_teaching_1.status_code == 201
    non_teaching_2 = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Counts NonTeaching Designation 2", category="NON_TEACHING"),
    )
    assert non_teaching_2.status_code == 201
    housekeeping = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Counts Housekeeping Designation", category="HOUSEKEEPING"),
    )
    assert housekeeping.status_code == 201

    unfiltered = client.get("/api/v1/designations", headers=auth_headers(client, super_admin))
    assert unfiltered.status_code == 200
    unfiltered_body = unfiltered.json()
    assert unfiltered_body["category_counts"]["TEACHING"] >= 1
    assert unfiltered_body["category_counts"]["NON_TEACHING"] >= 2
    assert unfiltered_body["category_counts"]["HOUSEKEEPING"] >= 1
    assert unfiltered_body["category_counts"]["ALL"] == unfiltered_body["total"]
    baseline_counts = unfiltered_body["category_counts"]

    # Narrowing items/total via the category filter must NOT change
    # category_counts -- switching tabs shouldn't collapse the other tabs'
    # displayed counts to zero.
    teaching_only = client.get(
        "/api/v1/designations?category=TEACHING", headers=auth_headers(client, super_admin)
    )
    assert teaching_only.status_code == 200
    teaching_body = teaching_only.json()
    assert teaching_body["total"] < unfiltered_body["total"]
    assert all(item["category"] == "TEACHING" for item in teaching_body["items"])
    assert teaching_body["category_counts"] == baseline_counts

    housekeeping_only = client.get(
        "/api/v1/designations?category=HOUSEKEEPING", headers=auth_headers(client, super_admin)
    )
    assert housekeeping_only.status_code == 200
    housekeeping_body = housekeeping_only.json()
    assert housekeeping_body["category_counts"] == baseline_counts


def test_category_counts_respect_is_active_filter_but_not_category(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    active_teaching = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Active Filter Teaching"),
    )
    assert active_teaching.status_code == 201

    inactive_non_teaching = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json=_payload(name="Inactive Filter NonTeaching", category="NON_TEACHING", is_active=False),
    )
    assert inactive_non_teaching.status_code == 201

    active_only = client.get(
        "/api/v1/designations?is_active=true", headers=auth_headers(client, super_admin)
    )
    assert active_only.status_code == 200
    active_body = active_only.json()
    names = {item["name"] for item in active_body["items"]}
    assert "Active Filter Teaching" in names
    assert "Inactive Filter NonTeaching" not in names
    # The is_active filter narrows counts too (it's applied before the
    # per-category GROUP BY, same as category/department_id/is_active are
    # all "every other active filter" this endpoint respects) -- so the
    # inactive designation must not be reflected here.
    assert active_body["category_counts"]["ALL"] == active_body["total"]
