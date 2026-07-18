from datetime import date

from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_list_employees_staff_role_happy_path(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = client.get("/api/v1/employees", headers=auth_headers(client, vacancy.hod))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    ids = {item["id"] for item in body["items"]}
    assert str(hired.employee.id) in ids
    # Default employment_status on a freshly created Employee row is ACTIVE.
    matching = next(item for item in body["items"] if item["id"] == str(hired.employee.id))
    assert matching["employment_status"] == "ACTIVE"
    assert matching["separation_date"] is None
    assert matching["separation_reason"] is None
    assert matching["separated_by_id"] is None


def test_get_employee_happy_path(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = client.get(
        f"/api/v1/employees/{hired.employee.id}", headers=auth_headers(client, vacancy.hod)
    )
    assert response.status_code == 200
    assert response.json()["employment_status"] == "ACTIVE"


def test_offboard_employee_resigned_success(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "RESIGNED",
            "separation_date": date.today().isoformat(),
            "reason": "Candidate accepted an offer elsewhere",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["employment_status"] == "RESIGNED"
    assert body["separation_date"] == date.today().isoformat()
    assert body["separation_reason"] == "Candidate accepted an offer elsewhere"
    assert body["separated_by_id"] == str(vacancy.hr_admin.id)


def test_offboard_employee_terminated_success(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "TERMINATED",
            "separation_date": date.today().isoformat(),
            "reason": "Performance-related termination",
        },
    )
    assert response.status_code == 200
    assert response.json()["employment_status"] == "TERMINATED"


def test_reoffboard_already_separated_employee_returns_409(
    client, published_vacancy_factory, hired_employee_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    first = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "RETIRED",
            "separation_date": date.today().isoformat(),
            "reason": "Retirement",
        },
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "RESIGNED",
            "separation_date": date.today().isoformat(),
            "reason": "Should not be allowed",
        },
    )
    assert second.status_code == 409
    assert "already separated" in second.json()["detail"]


def test_offboard_rejects_active_as_separation_type(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "ACTIVE",
            "separation_date": date.today().isoformat(),
            "reason": "Not a real separation",
        },
    )
    assert response.status_code == 422


def test_non_hr_staff_role_forbidden_on_offboard_but_can_get(
    client, published_vacancy_factory, hired_employee_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    # Campus HOD is a legitimate staff role (can GET, per _staff_only) but
    # not one of the HR-only roles gating the offboard action.
    offboard_response = client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hod),
        json={
            "separation_type": "RESIGNED",
            "separation_date": date.today().isoformat(),
            "reason": "Should be forbidden",
        },
    )
    assert offboard_response.status_code == 403

    get_response = client.get(
        f"/api/v1/employees/{hired.employee.id}", headers=auth_headers(client, vacancy.hod)
    )
    assert get_response.status_code == 200


def test_cross_campus_get_employee_returns_404(
    client, published_vacancy_factory, hired_employee_factory, user_factory
):
    # HR_ADMIN/SUPER_ADMIN (the only roles allowed to call offboard) are both
    # GLOBAL_SCOPE_ROLES, so enforce_campus_match never 404s them on the
    # offboard endpoint itself -- there is no role that both passes the
    # offboard require_roles() gate and is campus-scoped. This exercises the
    # exact same enforce_campus_match(scope, employee.campus_id) guard the
    # offboard endpoint uses, via the GET endpoint with a campus-scoped role
    # (mirrors tests/test_interviews.py's cross-campus 404 convention).
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    officer_other_campus = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCAD")

    response = client.get(
        f"/api/v1/employees/{hired.employee.id}", headers=auth_headers(client, officer_other_campus)
    )
    assert response.status_code == 404


def test_list_employees_employment_status_filter(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    active_hire = hired_employee_factory(vacancy)
    separated_hire = hired_employee_factory(vacancy)

    client.post(
        f"/api/v1/employees/{separated_hire.employee.id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "separation_type": "RESIGNED",
            "separation_date": date.today().isoformat(),
            "reason": "Moving on",
        },
    )

    active_response = client.get(
        "/api/v1/employees",
        headers=auth_headers(client, vacancy.hr_admin),
        params={"employment_status": "ACTIVE"},
    )
    assert active_response.status_code == 200
    active_ids = {item["id"] for item in active_response.json()["items"]}
    assert str(active_hire.employee.id) in active_ids
    assert str(separated_hire.employee.id) not in active_ids

    resigned_response = client.get(
        "/api/v1/employees",
        headers=auth_headers(client, vacancy.hr_admin),
        params={"employment_status": "RESIGNED"},
    )
    assert resigned_response.status_code == 200
    resigned_ids = {item["id"] for item in resigned_response.json()["items"]}
    assert str(separated_hire.employee.id) in resigned_ids
    assert str(active_hire.employee.id) not in resigned_ids
