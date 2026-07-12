from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def _create_payload(department_id, **overrides):
    payload = {
        "campus_id": None,
        "department_id": str(department_id),
        "role_category": "TEACHING",
        "position_title": "Assistant Professor",
        "employment_type": "FULL_TIME",
        "requested_count": 2,
        "qualification": "PhD",
        "experience_required": "3+ years",
        "priority": "HIGH",
    }
    payload.update(overrides)
    return payload


def test_hod_can_create_vacancy_request_for_own_campus(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 201
    assert response.json()["status"] == "DRAFT"


def test_hod_cannot_create_vacancy_request_for_other_campus(client, user_factory, department_factory):
    sse_department = department_factory("SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_scad),
        json=_create_payload(sse_department.id, campus_id=str(sse_department.campus_id)),
    )
    assert response.status_code == 403


def test_full_approval_chain_creates_slots_and_posting(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id), requested_count=3),
    )
    vr_id = create.json()["id"]

    submitted = client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    assert submitted.json()["status"] == "SUBMITTED"

    dean_approved = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean)
    )
    assert dean_approved.json()["status"] == "DEAN_APPROVED"

    hr_approved = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert hr_approved.status_code == 200
    approved_vacancy_id = hr_approved.json()["id"]
    assert hr_approved.json()["total_positions"] == 3

    slots = client.get(
        f"/api/v1/approved-vacancies/{approved_vacancy_id}/hiring-slots", headers=auth_headers(client, hr_admin)
    )
    assert slots.json()["total"] == 3
    assert all(s["status"] == "OPEN" for s in slots.json()["items"])

    published = client.post(f"/api/v1/vacancy-requests/{vr_id}/publish", headers=auth_headers(client, hr_admin))
    assert published.status_code == 200
    assert published.json()["is_active"] is True

    vr_detail = client.get(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hr_admin))
    assert vr_detail.json()["status"] == "PUBLISHED"


def test_recruitment_officer_cannot_dean_approve(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, officer)
    )
    assert response.status_code == 403


def test_reject_requires_reason(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject", headers=auth_headers(client, dean), json={"reason": ""}
    )
    assert response.status_code == 422


def test_super_admin_can_hr_approve_directly_from_submitted(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, super_admin)
    )
    assert response.status_code == 200


def test_hr_admin_cannot_hr_approve_from_submitted_without_dean(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 409


def test_cannot_edit_non_draft_vacancy_request(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hod), json={"position_title": "Changed"}
    )
    assert response.status_code == 409


def test_management_cannot_create_vacancy_request(client, user_factory, department_factory):
    department = department_factory("SSE")
    management = user_factory(UserRoleEnum.MANAGEMENT)

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, management),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 403
