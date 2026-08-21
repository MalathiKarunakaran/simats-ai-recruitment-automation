from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def _drive_to_joining_confirmed(client, vacancy, application):
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


def test_mark_joined_requires_joining_confirmed(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 409


def test_get_joining_record_returns_404_before_offer_accepted(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.get(
        f"/api/v1/applications/{application.id}/joining-record", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 409


def test_get_joining_record_happy_path(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    response = client.get(
        f"/api/v1/applications/{application.id}/joining-record", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["joining_date"] == "2026-09-01"
    assert response.json()["actual_joining_date"] is None


def test_allot_department_room_requires_all_documents_received(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    joined = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert joined.status_code == 200

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"department_id": str(vacancy.department.id)},
    )
    assert response.status_code == 409


def test_complete_orientation_requires_department_room_allotted(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)
    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-orientation",
        headers=auth_headers(client, vacancy.hr_admin),
        json={},
    )
    assert response.status_code == 409


def test_hand_over_to_hod_requires_orientation_complete(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)
    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )

    response = client.post(
        f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"hod_assigned": "Dr. Test HOD"},
    )
    assert response.status_code == 409


def test_full_joining_flow_creates_employee_and_sets_status(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, vacancy.hr_admin)
    )
    _mark_all_documents_received(client, vacancy, application.id)

    allotment = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"department_id": str(vacancy.department.id), "room_allotted": "R-204"},
    )
    assert allotment.status_code == 200

    orientation = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-orientation",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"orientation_date": "2026-09-05"},
    )
    assert orientation.status_code == 200

    employee = client.post(
        f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"hod_assigned": "Dr. Test HOD", "designation": "Assistant Professor"},
    )
    assert employee.status_code == 200
    assert employee.json()["employee_code"].startswith(f"{vacancy.campus.code}-")
    assert employee.json()["designation"] == "Assistant Professor"
    assert employee.json()["department_id"] == str(vacancy.department.id)

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "HANDED_OVER_TO_HOD"
    assert app_detail["room_allotted"] == "R-204"
    assert app_detail["orientation_date"] == "2026-09-05"
    assert app_detail["hod_assigned"] == "Dr. Test HOD"


def test_recruitment_coordinator_forbidden_from_joining_entirely(
    client, user_factory, published_vacancy_factory, application_factory
):
    # Joining/Onboarding access was removed entirely for
    # RECRUITMENT_COORDINATOR (a deliberate permission reduction) -- unlike
    # the other four action groups, this is not gated by a capability grant
    # at all, so the coordinator must be forbidden on every step here.
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    joining_record = client.get(
        f"/api/v1/applications/{application.id}/joining-record", headers=auth_headers(client, coordinator)
    )
    assert joining_record.status_code == 403

    joined = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=auth_headers(client, coordinator)
    )
    assert joined.status_code == 403

    documents = client.get(
        f"/api/v1/applications/{application.id}/joining-documents", headers=auth_headers(client, coordinator)
    )
    assert documents.status_code == 403

    allotment = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=auth_headers(client, coordinator),
        json={"department_id": str(vacancy.department.id)},
    )
    assert allotment.status_code == 403

    orientation = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-orientation",
        headers=auth_headers(client, coordinator),
        json={},
    )
    assert orientation.status_code == 403

    employee = client.post(
        f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
        headers=auth_headers(client, coordinator),
        json={"hod_assigned": "Dr. Test HOD"},
    )
    assert employee.status_code == 403


def test_recruitment_officer_can_complete_full_onboarding_flow(
    client, published_vacancy_factory, application_factory
):
    # Phase 2 of the permission-matrix epic deliberately closed a known
    # frontend/backend drift: AppShell's nav has always shown /onboarding to
    # RECRUITMENT_OFFICER, but before this cutover the 4 write actions past
    # mark-joined (allot-room/orientation/handover/document-status) were
    # HR_ADMIN-only. RECRUITMENT_OFFICER holds ONBOARDING by Phase 1 default,
    # so every step here should now succeed for a plain RECRUITMENT_OFFICER,
    # not just HR_ADMIN -- confirmed with the user before this change.
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)
    officer_headers = auth_headers(client, vacancy.recruitment_officer)

    joined = client.post(
        f"/api/v1/applications/{application.id}/joining/mark-joined", headers=officer_headers
    )
    assert joined.status_code == 200

    documents = client.get(
        f"/api/v1/applications/{application.id}/joining-documents", headers=officer_headers
    ).json()["items"]
    for doc in documents:
        updated = client.patch(
            f"/api/v1/joining-documents/{doc['id']}", headers=officer_headers, json={"status": "RECEIVED"}
        )
        assert updated.status_code == 200

    allotment = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=officer_headers,
        json={"department_id": str(vacancy.department.id), "room_allotted": "R-301"},
    )
    assert allotment.status_code == 200

    orientation = client.post(
        f"/api/v1/applications/{application.id}/joining/complete-orientation",
        headers=officer_headers,
        json={"orientation_date": "2026-09-05"},
    )
    assert orientation.status_code == 200

    employee = client.post(
        f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
        headers=officer_headers,
        json={"hod_assigned": "Dr. Test HOD", "designation": "Assistant Professor"},
    )
    assert employee.status_code == 200


def test_campus_hod_still_forbidden_from_joining(client, user_factory, published_vacancy_factory, application_factory):
    # Regression check: CAMPUS_HOD's Phase 1 default permission set does not
    # include ONBOARDING -- must stay 403, unlike RECRUITMENT_OFFICER above.
    hod = user_factory(UserRoleEnum.CAMPUS_HOD)
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)

    response = client.get(
        f"/api/v1/applications/{application.id}/joining-record", headers=auth_headers(client, hod)
    )
    assert response.status_code == 403


def test_employee_codes_are_sequential_per_campus(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=2)

    codes = []
    for _ in range(2):
        application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
        _drive_to_joining_confirmed(client, vacancy, application)
        client.post(
            f"/api/v1/applications/{application.id}/joining/mark-joined",
            headers=auth_headers(client, vacancy.hr_admin),
        )
        _mark_all_documents_received(client, vacancy, application.id)
        client.post(
            f"/api/v1/applications/{application.id}/joining/allot-department-room",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"department_id": str(vacancy.department.id)},
        )
        client.post(
            f"/api/v1/applications/{application.id}/joining/complete-orientation",
            headers=auth_headers(client, vacancy.hr_admin),
            json={},
        )
        employee = client.post(
            f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"hod_assigned": "Dr. Test HOD"},
        ).json()
        codes.append(employee["employee_code"])

    assert len(set(codes)) == 2
    assert sorted(codes) == codes
