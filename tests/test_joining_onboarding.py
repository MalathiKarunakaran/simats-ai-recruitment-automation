from tests.conftest import auth_headers


def _drive_to_joining_pending(client, vacancy, application):
    client.patch(
        f"/api/v1/applications/{application.id}/status",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"status": "SELECTED"},
    )
    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    ).json()
    client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))
    client.post(f"/api/v1/offers/{offer['id']}/accept", headers=auth_headers(client, vacancy.hr_admin))
    return offer


def _mark_all_documents_received(client, vacancy, application_id):
    documents = client.get(
        f"/api/v1/applications/{application_id}/joining-documents", headers=auth_headers(client, vacancy.hr_admin)
    ).json()["items"]
    for doc in documents:
        client.patch(
            f"/api/v1/joining-documents/{doc['id']}",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"status": "RECEIVED"},
        )


def test_mark_joined_requires_joining_pending(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 409


def test_complete_onboarding_requires_all_documents_received(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_pending(client, vacancy, application)

    joined = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert joined.status_code == 200

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-onboarding",
        headers=auth_headers(client, vacancy.hr_admin),
    )
    assert response.status_code == 409


def test_create_employee_requires_onboarding_complete(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_pending(client, vacancy, application)
    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/create-employee",
        headers=auth_headers(client, vacancy.hr_admin),
        json={},
    )
    assert response.status_code == 409


def test_full_joining_flow_creates_employee_and_sets_status(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_pending(client, vacancy, application)

    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    _mark_all_documents_received(client, vacancy, application.id)

    onboarding = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-onboarding",
        headers=auth_headers(client, vacancy.hr_admin),
    )
    assert onboarding.status_code == 200

    employee = client.post(
        f"/api/v1/applications/{application.id}/joining/create-employee",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"designation": "Assistant Professor"},
    )
    assert employee.status_code == 200
    assert employee.json()["employee_code"].startswith(f"{vacancy.campus.code}-")
    assert employee.json()["designation"] == "Assistant Professor"

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "EMPLOYEE_CREATED"


def test_employee_codes_are_sequential_per_campus(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=2)

    codes = []
    for _ in range(2):
        application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
        _drive_to_joining_pending(client, vacancy, application)
        client.post(
            f"/api/v1/applications/{application.id}/joining/mark-joined",
            headers=auth_headers(client, vacancy.hr_admin),
        )
        _mark_all_documents_received(client, vacancy, application.id)
        client.post(
            f"/api/v1/applications/{application.id}/joining/complete-onboarding",
            headers=auth_headers(client, vacancy.hr_admin),
        )
        employee = client.post(
            f"/api/v1/applications/{application.id}/joining/create-employee",
            headers=auth_headers(client, vacancy.hr_admin),
            json={},
        ).json()
        codes.append(employee["employee_code"])

    assert len(set(codes)) == 2
    assert sorted(codes) == codes
