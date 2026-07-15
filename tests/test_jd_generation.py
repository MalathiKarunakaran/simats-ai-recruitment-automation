from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_hod_can_generate_jd_for_own_draft_vacancy(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json={
            "campus_id": str(department.campus_id),
            "department_id": str(department.id),
            "role_category": "TEACHING",
            "position_title": "Assistant Professor",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "PhD",
            "experience_required": "3+ years",
        },
    )
    vr_id = create.json()["id"]
    assert create.json()["jd_draft"] is None

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/generate-jd",
        headers=auth_headers(client, hod),
        json={},
    )
    assert response.status_code == 200
    jd_draft = response.json()["jd_draft"]
    assert "Role Overview" in jd_draft
    assert "Responsibilities" in jd_draft
    assert "Required Qualifications" in jd_draft


def test_generate_jd_requires_draft_status(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json={
            "campus_id": str(department.campus_id),
            "department_id": str(department.id),
            "role_category": "TEACHING",
            "position_title": "Assistant Professor",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "PhD",
            "experience_required": "3+ years",
        },
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/generate-jd", headers=auth_headers(client, hod), json={}
    )
    assert response.status_code == 409


def test_recruitment_officer_cannot_generate_jd(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json={
            "campus_id": str(department.campus_id),
            "department_id": str(department.id),
            "role_category": "TEACHING",
            "position_title": "Assistant Professor",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "PhD",
            "experience_required": "3+ years",
        },
    )
    vr_id = create.json()["id"]

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/generate-jd", headers=auth_headers(client, officer), json={}
    )
    assert response.status_code == 403


def test_generate_jd_ai_error_maps_to_502(client, user_factory, department_factory, fake_openai_client):
    import httpx
    import openai

    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json={
            "campus_id": str(department.campus_id),
            "department_id": str(department.id),
            "role_category": "TEACHING",
            "position_title": "Assistant Professor",
            "employment_type": "FULL_TIME",
            "requested_count": 1,
            "qualification": "PhD",
            "experience_required": "3+ years",
        },
    )
    vr_id = create.json()["id"]

    def _raise_connection_error(**kwargs):
        req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        raise openai.APIConnectionError(request=req)

    fake_openai_client.chat.completions.create = _raise_connection_error

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/generate-jd", headers=auth_headers(client, hod), json={}
    )
    assert response.status_code == 502
