from tests.conftest import auth_headers


def _select(client, application_id, actor):
    return client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=auth_headers(client, actor),
        json={"status": "SELECTED"},
    )


def test_send_offer_advances_application_to_offer_sent(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    ).json()

    send = client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))
    assert send.status_code == 200
    assert send.json()["status"] == "SENT"

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "OFFER_SENT"


def test_accept_offer_creates_joining_record_and_default_documents(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    ).json()
    client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))
    accept = client.post(f"/api/v1/offers/{offer['id']}/accept", headers=auth_headers(client, vacancy.hr_admin))
    assert accept.status_code == 200
    assert accept.json()["status"] == "ACCEPTED"

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "JOINING_PENDING"

    documents = client.get(
        f"/api/v1/applications/{application.id}/joining-documents", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert documents["total"] == 6
    assert all(d["status"] == "PENDING" for d in documents["items"])


def test_withdraw_offer_leaves_application_status_untouched(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    ).json()
    client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))
    withdraw = client.post(f"/api/v1/offers/{offer['id']}/withdraw", headers=auth_headers(client, vacancy.hr_admin))
    assert withdraw.status_code == 200
    assert withdraw.json()["status"] == "WITHDRAWN"

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "OFFER_SENT"


def test_second_offer_blocked_while_first_is_active(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    payload = {"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"}
    first = client.post("/api/v1/offers", headers=auth_headers(client, vacancy.hr_admin), json=payload)
    assert first.status_code == 201

    second = client.post("/api/v1/offers", headers=auth_headers(client, vacancy.hr_admin), json=payload)
    assert second.status_code == 409


def test_mark_offer_expired(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    ).json()
    client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))

    expired = client.post(
        f"/api/v1/offers/{offer['id']}/mark-expired", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert expired.status_code == 200
    assert expired.json()["status"] == "EXPIRED"


def test_recruitment_officer_cannot_create_offer(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _select(client, application.id, vacancy.hr_admin)

    response = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    )
    assert response.status_code == 403
