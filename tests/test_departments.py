from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_hod_can_create_department_in_own_campus(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, hod),
        json={"campus_id": str(sse.id), "name": "Computer Science"},
    )
    assert response.status_code == 201
    assert response.json()["campus_id"] == str(sse.id)


def test_hod_cannot_create_department_in_other_campus(client, user_factory, campus_factory):
    scad = campus_factory("SCAD")
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, hod_sse),
        json={"campus_id": str(scad.id), "name": "Dentistry"},
    )
    assert response.status_code == 403


def test_department_list_is_campus_scoped_for_hod(client, user_factory, campus_factory, db_session):
    from app.models.department import Department

    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    db_session.add_all(
        [
            Department(campus_id=sse.id, name="SSE Dept"),
            Department(campus_id=scad.id, name="SCAD Dept"),
        ]
    )
    db_session.flush()

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/departments", headers=auth_headers(client, hod_sse))
    names = {d["name"] for d in response.json()["items"]}
    assert "SSE Dept" in names
    assert "SCAD Dept" not in names


def test_candidate_cannot_list_departments(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/departments", headers=auth_headers(client, candidate))
    assert response.status_code == 403
