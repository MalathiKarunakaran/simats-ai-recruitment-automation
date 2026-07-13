from app.models.enums import UserRoleEnum
from app.models.notification import Notification
from app.services import notifications

from tests.conftest import FakeN8nClient, auth_headers


def test_notify_marks_failed_when_n8n_unconfigured(db_session, user_factory):
    """N8N_BASE_URL is unset by default in dev/test -- notify() must degrade
    to a FAILED row (not fake success like the old Phase 3 stub)."""
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    notification = notifications.notify(
        db_session,
        recipient_user=hr_admin,
        notification_type="TEST_EVENT",
        subject="Test subject",
        body="Test body",
    )
    assert notification.status.value == "FAILED"
    assert notification.error_message == "n8n not configured"
    assert notification.sent_at is None
    assert notification.recipient_user_id == hr_admin.id


def test_notify_marks_sent_when_n8n_configured(db_session, user_factory, monkeypatch):
    fake_client = FakeN8nClient()
    monkeypatch.setattr("app.services.notifications.get_n8n_client", lambda: fake_client)

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    notification = notifications.notify(
        db_session,
        recipient_user=hr_admin,
        notification_type="TEST_EVENT",
        subject="Test subject",
        body="Test body",
    )
    assert notification.status.value == "SENT"
    assert notification.error_message is None
    assert notification.sent_at is not None
    assert len(fake_client.calls) == 1
    path, payload = fake_client.calls[0]
    assert path == "notify"
    assert payload["channel"] == "EMAIL"
    assert payload["subject"] == "Test subject"


def test_notify_marks_failed_and_does_not_crash_caller_when_webhook_raises(
    db_session, user_factory, department_factory, monkeypatch
):
    import httpx

    from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, VacancyPriorityEnum, VacancyRequestStatusEnum
    from app.models.vacancy_request import VacancyRequest
    from app.services import vacancy_workflow

    fake_client = FakeN8nClient(raises=httpx.ConnectError("boom"))
    monkeypatch.setattr("app.services.notifications.get_n8n_client", lambda: fake_client)

    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    vr = VacancyRequest(
        campus_id=department.campus_id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title="Test Position",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=1,
        qualification="Test",
        experience_required="Test",
        priority=VacancyPriorityEnum.NORMAL,
        requested_by_id=hod.id,
    )
    db_session.add(vr)
    db_session.flush()

    vacancy_workflow.submit(db_session, vr, hod, None)

    assert vr.status == VacancyRequestStatusEnum.SUBMITTED
    row = db_session.query(Notification).filter(Notification.notification_type == "VACANCY_REQUEST_SUBMITTED").one()
    assert row.status.value == "FAILED"
    assert "boom" in row.error_message


def test_notify_requires_a_recipient(db_session):
    import pytest

    with pytest.raises(ValueError):
        notifications.notify(db_session, notification_type="X", subject="X", body="X")


def test_notify_role_fans_out_only_to_matching_active_users(db_session, user_factory):
    hr_admin_1 = user_factory(UserRoleEnum.HR_ADMIN)
    hr_admin_2 = user_factory(UserRoleEnum.HR_ADMIN)
    inactive_hr_admin = user_factory(UserRoleEnum.HR_ADMIN, is_active=False)
    other_role = user_factory(UserRoleEnum.MANAGEMENT)

    sent = notifications.notify_role(
        db_session,
        roles={UserRoleEnum.HR_ADMIN},
        notification_type="TEST_FANOUT",
        subject="Fanout test",
        body="Body",
    )
    recipient_ids = {n.recipient_user_id for n in sent}
    assert recipient_ids == {hr_admin_1.id, hr_admin_2.id}
    assert inactive_hr_admin.id not in recipient_ids
    assert other_role.id not in recipient_ids


def test_notify_role_all_sent_when_n8n_configured(db_session, user_factory, monkeypatch):
    fake_client = FakeN8nClient()
    monkeypatch.setattr("app.services.notifications.get_n8n_client", lambda: fake_client)

    hr_admin_1 = user_factory(UserRoleEnum.HR_ADMIN)
    hr_admin_2 = user_factory(UserRoleEnum.HR_ADMIN)

    sent = notifications.notify_role(
        db_session,
        roles={UserRoleEnum.HR_ADMIN},
        notification_type="TEST_FANOUT",
        subject="Fanout test",
        body="Body",
    )
    assert {n.recipient_user_id for n in sent} == {hr_admin_1.id, hr_admin_2.id}
    assert all(n.status.value == "SENT" for n in sent)
    assert len(fake_client.calls) == 2


def test_notify_role_campus_filters_single_campus_roles(db_session, user_factory, campus_factory):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    sent = notifications.notify_role(
        db_session,
        roles={UserRoleEnum.CAMPUS_HOD},
        campus_id=sse.id,
        notification_type="TEST_CAMPUS_FILTER",
        subject="Campus filter test",
        body="Body",
    )
    recipient_ids = {n.recipient_user_id for n in sent}
    assert recipient_ids == {hod_sse.id}
    assert hod_scad.id not in recipient_ids


def test_vacancy_submit_creates_notification_for_dean(db_session, user_factory, department_factory):
    from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, VacancyPriorityEnum
    from app.models.vacancy_request import VacancyRequest
    from app.services import vacancy_workflow

    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    vr = VacancyRequest(
        campus_id=department.campus_id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title="Test Position",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=1,
        qualification="Test",
        experience_required="Test",
        priority=VacancyPriorityEnum.NORMAL,
        requested_by_id=hod.id,
    )
    db_session.add(vr)
    db_session.flush()

    vacancy_workflow.submit(db_session, vr, hod, None)

    rows = db_session.query(Notification).filter(Notification.recipient_user_id == dean.id).all()
    assert len(rows) == 1
    assert rows[0].notification_type == "VACANCY_REQUEST_SUBMITTED"


def test_selecting_application_notifies_candidate(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = client.patch(
        f"/api/v1/applications/{application.id}/status",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"status": "SELECTED"},
    )
    assert response.status_code == 200

    candidate_email = application.candidate.email
    rows = (
        db_session.query(Notification)
        .filter(Notification.recipient_email == candidate_email, Notification.notification_type == "APPLICATION_SELECTED")
        .all()
    )
    assert len(rows) == 1


def test_offer_sent_notifies_candidate(client, published_vacancy_factory, application_factory, db_session):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
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

    rows = (
        db_session.query(Notification)
        .filter(
            Notification.recipient_email == application.candidate.email,
            Notification.notification_type == "OFFER_SENT",
        )
        .all()
    )
    assert len(rows) == 1


def test_notifications_list_scoped_to_own_campus_for_hod(
    client, published_vacancy_factory, application_factory
):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application_factory(vacancy_sse.job_posting, recorded_by=vacancy_sse.hr_admin)
    application_factory(vacancy_scad.job_posting, recorded_by=vacancy_scad.hr_admin)

    response = client.get("/api/v1/notifications", headers=auth_headers(client, vacancy_sse.hod))
    assert response.status_code == 200
    for item in response.json()["items"]:
        assert (
            item["campus_context_id"] == str(vacancy_sse.campus.id)
            or item["recipient_user_id"] == str(vacancy_sse.hod.id)
        )


def test_candidate_role_cannot_list_notifications(client, user_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/notifications", headers=auth_headers(client, candidate_user))
    assert response.status_code == 403
