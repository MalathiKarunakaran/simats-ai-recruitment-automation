from datetime import datetime, timedelta, timezone

from app.models.enums import CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum

from tests.conftest import auth_headers


def _select(client, application_id, actor):
    return client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=auth_headers(client, actor),
        json={"status": "CALLED_FOR_INTERVIEW"},
    )


def _iso_future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def test_schedule_interview_advances_application_status(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "meeting_link": "https://meet.example.com/abc",
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "SCHEDULED"
    assert response.json()["panel_member_ids"] == [str(panel_member.id)]

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "CALLED_FOR_INTERVIEW"


def test_recruitment_coordinator_without_grant_forbidden_to_schedule_interview(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, coordinator),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "meeting_link": "https://meet.example.com/abc",
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 403


def test_recruitment_coordinator_with_interviews_grant_can_schedule_interview(
    client, published_vacancy_factory, application_factory, user_factory, grant_coordinator_capability, grant_permission
):
    # Both grants inserted directly -- CoordinatorCapabilityGrant (still real)
    # plus the UserPermissionGrant this endpoint actually checks now
    # (require_permission(SCHEDULE_INTERVIEW)), mirroring what a real
    # coordinator would have post-migration-backfill (e5a4d57be056 maps
    # INTERVIEWS onto SCHEDULE_INTERVIEW/RESCHEDULE_INTERVIEW/
    # CANCEL_INTERVIEW/MARK_INTERVIEW_COMPLETED) -- the test DB never runs
    # that migration, so both are inserted directly here.
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.INTERVIEWS)
    grant_permission(coordinator, PermissionEnum.SCHEDULE_INTERVIEW)

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, coordinator),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "meeting_link": "https://meet.example.com/abc",
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "SCHEDULED"


def test_schedule_interview_rejects_panel_member_from_other_campus(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member_scad = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SCAD")

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "HR",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member_scad.id)],
        },
    )
    assert response.status_code == 400


def test_panel_member_can_submit_feedback(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    ).json()

    response = client.post(
        f"/api/v1/interviews/{schedule['id']}/feedback",
        headers=auth_headers(client, panel_member),
        json={
            "technical_score": 8,
            "communication_score": 7,
            "research_score": 6,
            "overall_recommendation": "HIRE",
            "comments": "Solid technical understanding.",
        },
    )
    assert response.status_code == 201
    assert response.json()["overall_recommendation"] == "HIRE"
    # Non-Teaching role_category (default TEACHING in the fixture -- see below):
    # teaching_demo_score handling is asserted separately per role_category.


def test_unassigned_panel_member_cannot_submit_feedback(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assigned = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    not_assigned = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "HR",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(assigned.id)],
        },
    ).json()

    response = client.post(
        f"/api/v1/interviews/{schedule['id']}/feedback",
        headers=auth_headers(client, not_assigned),
        json={"overall_recommendation": "NO_HIRE"},
    )
    assert response.status_code == 403


def test_duplicate_feedback_from_same_panel_member_rejected(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "HR",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    ).json()

    payload = {"overall_recommendation": "HIRE"}
    first = client.post(
        f"/api/v1/interviews/{schedule['id']}/feedback", headers=auth_headers(client, panel_member), json=payload
    )
    assert first.status_code == 201
    second = client.post(
        f"/api/v1/interviews/{schedule['id']}/feedback", headers=auth_headers(client, panel_member), json=payload
    )
    assert second.status_code == 409


def test_teaching_demo_score_only_kept_for_teaching_role_category(
    client, published_vacancy_factory, application_factory, user_factory, db_session
):
    from app.models.enums import StaffRoleCategoryEnum

    # published_vacancy_factory defaults role_category to TEACHING.
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    assert vacancy.vacancy_request.role_category == StaffRoleCategoryEnum.TEACHING
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TEACHING_DEMO",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    ).json()

    response = client.post(
        f"/api/v1/interviews/{schedule['id']}/feedback",
        headers=auth_headers(client, panel_member),
        json={"teaching_demo_score": 9, "overall_recommendation": "STRONG_HIRE"},
    )
    assert response.status_code == 201
    assert response.json()["teaching_demo_score"] == 9


def test_mark_interview_completed(client, published_vacancy_factory, application_factory, user_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "HR",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    ).json()

    response = client.patch(
        f"/api/v1/interviews/{schedule['id']}", headers=auth_headers(client, vacancy.hr_admin), json={"status": "COMPLETED"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"

    app_detail = client.get(
        f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert app_detail["status"] == "INTERVIEWED"


def test_generate_interview_questions(client, published_vacancy_factory, application_factory, user_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    schedule = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    ).json()

    response = client.post(
        f"/api/v1/interviews/{schedule['id']}/generate-questions", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert len(response.json()["questions"]) > 0


def test_recruitment_officer_cannot_schedule_interview_for_other_campus(
    client, published_vacancy_factory, application_factory, user_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    officer_scad = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCAD")
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, officer_scad),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 404


def test_panel_notification_names_the_candidate_and_reads_in_ist(
    client, db_session, published_vacancy_factory, application_factory, user_factory
):
    """Panel members get this by email (2026-10-30): it must name who and
    what, and give the time as a person reads it, not as UTC isoformat."""
    from app.models.notification import Notification

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    when = (datetime.now(timezone.utc) + timedelta(days=3)).replace(hour=4, minute=30, second=0, microsecond=0)

    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": when.isoformat(),
            "location": "Room 101",
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 201

    note = (
        db_session.query(Notification)
        .filter(Notification.recipient_user_id == panel_member.id, Notification.notification_type == "INTERVIEW_SCHEDULED")
        .one()
    )
    expected_when = when.astimezone(timezone(timedelta(hours=5, minutes=30))).strftime("%a %d %b %Y, 10:00 AM IST")
    assert application.candidate.full_name in note.subject
    assert expected_when in note.subject
    assert vacancy.job_posting.position_title in note.body
    assert "Where: Room 101." in note.body
    assert "+00:00" not in note.subject + note.body
