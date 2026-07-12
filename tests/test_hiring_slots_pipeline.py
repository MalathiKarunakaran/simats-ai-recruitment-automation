from app.models.enums import HiringSlotStatusEnum

from tests.conftest import auth_headers


def _transition(client, application_id, actor, new_status, reason=None, force=False):
    body = {"status": new_status, "force": force}
    if reason is not None:
        body["reason"] = reason
    return client.patch(
        f"/api/v1/applications/{application_id}/status", headers=auth_headers(client, actor), json=body
    )


def test_selecting_application_reserves_open_slot(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _transition(client, application.id, vacancy.hr_admin, "SELECTED")
    assert response.status_code == 200

    db_session.refresh(application)
    from app.models.hiring_slot import HiringSlot

    slot = db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id).one()
    assert slot.status == HiringSlotStatusEnum.RESERVED
    assert slot.reserved_application_id == application.id


def test_selecting_application_fails_when_no_open_slots_returns_409(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    app1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    app2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    assert _transition(client, app1.id, vacancy.hr_admin, "SELECTED").status_code == 200
    response = _transition(client, app2.id, vacancy.hr_admin, "SELECTED")
    assert response.status_code == 409


def test_rejecting_selected_application_releases_slot_back_to_open(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    _transition(client, application.id, vacancy.hr_admin, "SELECTED")
    response = _transition(client, application.id, vacancy.hr_admin, "REJECTED", reason="Not a fit")
    assert response.status_code == 200

    from app.models.hiring_slot import HiringSlot

    slot = db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id).one()
    assert slot.status == HiringSlotStatusEnum.OPEN
    assert slot.reserved_application_id is None
    assert slot.released_at is not None


def test_offer_decline_releases_slot_and_rejects_application(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _transition(client, application.id, vacancy.hr_admin, "SELECTED")

    offer = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"application_id": str(application.id), "salary_amount": 50000, "joining_date": "2026-09-01"},
    ).json()
    client.post(f"/api/v1/offers/{offer['id']}/send", headers=auth_headers(client, vacancy.hr_admin))

    decline = client.post(
        f"/api/v1/offers/{offer['id']}/decline",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"reason": "Candidate accepted another job"},
    )
    assert decline.status_code == 200

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "REJECTED"

    slots = client.get(
        f"/api/v1/approved-vacancies/{vacancy.approved_vacancy.id}/hiring-slots",
        headers=auth_headers(client, vacancy.hr_admin),
    ).json()["items"]
    assert slots[0]["status"] == "OPEN"


def test_joined_requires_prior_selection(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _transition(client, application.id, vacancy.hr_admin, "JOINED")
    assert response.status_code == 409


def test_vacancy_autocloses_when_all_slots_filled(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    _transition(client, application.id, vacancy.hr_admin, "SELECTED")
    response = _transition(client, application.id, vacancy.hr_admin, "JOINED")
    assert response.status_code == 200

    db_session.refresh(vacancy.approved_vacancy)
    db_session.refresh(vacancy.job_posting)
    db_session.refresh(vacancy.vacancy_request)
    assert vacancy.approved_vacancy.closed_at is not None
    assert vacancy.job_posting.is_active is False
    assert vacancy.vacancy_request.status.value == "CLOSED"

    from app.models.audit_log import AuditLog

    autoclose_logs = db_session.query(AuditLog).filter(AuditLog.action == "VACANCY_AUTO_CLOSE").all()
    assert len(autoclose_logs) == 1


def test_partial_fill_does_not_autoclose(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=2)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    _transition(client, application.id, vacancy.hr_admin, "SELECTED")
    _transition(client, application.id, vacancy.hr_admin, "JOINED")

    db_session.refresh(vacancy.approved_vacancy)
    assert vacancy.approved_vacancy.closed_at is None


def test_skip_ahead_transition_allowed(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _transition(client, application.id, vacancy.hr_admin, "SELECTED")
    assert response.status_code == 200
    assert response.json()["status"] == "SELECTED"


def test_backward_transition_without_force_rejected(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    _transition(client, application.id, vacancy.hr_admin, "SHORTLISTED")
    response = _transition(client, application.id, vacancy.hr_admin, "SCREENING")
    assert response.status_code == 409


def test_rejected_reachable_from_any_nonterminal_status(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    _transition(client, application.id, vacancy.hr_admin, "SCREENING")
    response = _transition(client, application.id, vacancy.hr_admin, "REJECTED", reason="Withdrew")
    assert response.status_code == 200


def test_rejected_without_reason_is_rejected(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.patch(
        f"/api/v1/applications/{application.id}/status",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"status": "REJECTED"},
    )
    assert response.status_code == 422


def test_cannot_transition_out_of_terminal_status_without_force(
    client, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _transition(client, application.id, vacancy.hr_admin, "REJECTED", reason="No fit")

    response = _transition(client, application.id, vacancy.hr_admin, "SCREENING")
    assert response.status_code == 409


def test_force_correction_requires_super_admin(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _transition(client, application.id, vacancy.hr_admin, "REJECTED", reason="No fit")

    response = _transition(client, application.id, vacancy.hr_admin, "SCREENING", force=True)
    assert response.status_code == 403


def test_force_correction_by_super_admin_logs_distinct_audit_action(
    client, published_vacancy_factory, application_factory, user_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _transition(client, application.id, vacancy.hr_admin, "REJECTED", reason="No fit")

    from app.models.enums import UserRoleEnum

    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = _transition(client, application.id, super_admin, "SCREENING", force=True)
    assert response.status_code == 200

    from app.models.audit_log import AuditLog

    force_logs = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "APPLICATION_STATUS_FORCE_CORRECTION", AuditLog.entity_id == application.id)
        .all()
    )
    assert len(force_logs) == 1
    normal_logs = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "APPLICATION_STATUS_TRANSITION", AuditLog.entity_id == application.id)
        .all()
    )
    assert len(normal_logs) >= 1
