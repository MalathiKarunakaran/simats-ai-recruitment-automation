from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def _transition_application(client, application_id, actor, new_status, reason=None):
    body = {"status": new_status}
    if reason is not None:
        body["reason"] = reason
    return client.patch(
        f"/api/v1/applications/{application_id}/status", headers=auth_headers(client, actor), json=body
    )


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


def test_editing_a_draft_with_a_salary_band_set_round_trips_as_float(client, user_factory, department_factory):
    # Regression test: VacancyRequest.salary_band_min/max are Numeric columns
    # that SQLAlchemy returns as decimal.Decimal by default once a row is
    # reloaded from the DB (contradicting their Mapped[float | None] type
    # hint) -- the PATCH audit-log snapshot embeds the freshly-loaded value
    # directly into a dict destined for JSON storage, which crashed with
    # "Object of type Decimal is not JSON serializable" before the columns
    # were declared asdecimal=False.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id), salary_band_min=50000, salary_band_max=70000),
    )
    assert create.status_code == 201
    vr_id = create.json()["id"]

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}",
        headers=auth_headers(client, hod),
        json={"salary_band_min": 55000, "salary_band_max": 75000},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["salary_band_min"] == 55000
    assert body["salary_band_max"] == 75000
    assert isinstance(body["salary_band_min"], float | int)


def test_management_cannot_create_vacancy_request(client, user_factory, department_factory):
    department = department_factory("SSE")
    management = user_factory(UserRoleEnum.MANAGEMENT)

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, management),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 403


# --- Cancel ------------------------------------------------------------


def test_cancel_from_submitted_succeeds(client, user_factory, department_factory):
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
        f"/api/v1/vacancy-requests/{vr_id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Position no longer needed"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "CANCELLED"
    assert body["cancellation_reason"] == "Position no longer needed"
    assert body["cancelled_at"] is not None
    assert body["cancelled_by_id"] == str(hr_admin.id)


def test_cancel_from_published_succeeds(client, user_factory, published_vacancy_factory, db_session):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Budget freeze"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"

    db_session.refresh(vacancy.approved_vacancy)
    db_session.refresh(vacancy.job_posting)
    assert vacancy.approved_vacancy.closed_at is not None
    assert vacancy.job_posting.closed_at is not None
    assert vacancy.job_posting.is_active is False


def test_cancel_blocked_when_slot_committed(
    client, user_factory, published_vacancy_factory, application_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "No longer needed"},
    )
    assert response.status_code == 409
    assert "reserved or filled" in response.json()["detail"]


def test_cancel_blocked_from_closed_status(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Too late"},
    )
    assert response.status_code == 409


def test_cancel_blocked_from_rejected_status(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, dean),
        json={"reason": "Not needed"},
    )

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Too late"},
    )
    assert response.status_code == 409


def test_cancel_blocked_from_already_cancelled_status(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()

    first = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "First cancel"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Second cancel"},
    )
    assert second.status_code == 409


def test_cancel_forbidden_for_campus_hod(client, user_factory, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, vacancy.hod),
        json={"reason": "Not needed"},
    )
    assert response.status_code == 403


def test_cancel_forbidden_for_recruitment_officer(client, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"reason": "Not needed"},
    )
    assert response.status_code == 403


# --- Slot count adjustment ----------------------------------------------


def test_slot_count_increase_adds_open_slots(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 4},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 4

    slots = client.get(
        f"/api/v1/approved-vacancies/{vacancy.approved_vacancy.id}/hiring-slots",
        headers=auth_headers(client, hr_admin),
    )
    assert slots.json()["total"] == 4
    assert all(s["status"] == "OPEN" for s in slots.json()["items"])

    vr_detail = client.get(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}", headers=auth_headers(client, hr_admin)
    )
    assert vr_detail.json()["requested_count"] == 4


def test_slot_count_decrease_succeeds_with_open_headroom(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 1

    slots = client.get(
        f"/api/v1/approved-vacancies/{vacancy.approved_vacancy.id}/hiring-slots",
        headers=auth_headers(client, hr_admin),
    )
    assert slots.json()["total"] == 1


def test_slot_count_decrease_blocked_below_committed(
    client, user_factory, published_vacancy_factory, application_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)
    app1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    app2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, app1.id, vacancy.hr_admin, "SELECTED").status_code == 200
    assert _transition_application(client, app2.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 409
    assert "2 slot(s)" in response.json()["detail"]


def test_slot_count_adjustment_to_filled_count_autocloses(
    client, user_factory, published_vacancy_factory, application_factory, db_session
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200
    assert _transition_application(client, application.id, vacancy.hr_admin, "JOINED").status_code == 200

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 1

    vr_detail = client.get(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}", headers=auth_headers(client, hr_admin)
    )
    assert vr_detail.json()["status"] == "CLOSED"

    db_session.refresh(vacancy.approved_vacancy)
    db_session.refresh(vacancy.job_posting)
    assert vacancy.approved_vacancy.closed_at is not None
    assert vacancy.job_posting.is_active is False


def test_slot_count_adjustment_blocked_after_close(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 5},
    )
    assert response.status_code == 409
    assert "approved or published" in response.json()["detail"]


def test_slot_count_adjustment_requires_approved_vacancy(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 5},
    )
    assert response.status_code == 409
    assert "has not been approved" in response.json()["detail"]


def test_slot_count_adjustment_forbidden_for_campus_hod(client, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, vacancy.hod),
        json={"requested_count": 5},
    )
    assert response.status_code == 403


# --- Approved-vacancy filter ---------------------------------------------


def test_list_approved_vacancies_filters_by_vacancy_request_id(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy_a = published_vacancy_factory()
    vacancy_b = published_vacancy_factory()

    response = client.get(
        "/api/v1/approved-vacancies",
        headers=auth_headers(client, hr_admin),
        params={"vacancy_request_id": str(vacancy_a.vacancy_request.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(vacancy_a.approved_vacancy.id)
