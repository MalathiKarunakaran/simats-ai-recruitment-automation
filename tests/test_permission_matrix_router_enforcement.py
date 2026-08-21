"""Phase 2 of the granular permission-matrix epic: require_permission()
router cutover coverage. One test per unique PermissionEnum introduced on a
router in this phase, each asserting the same 3-way shape: a user with the
permission explicitly granted (via the grant_permission fixture, independent
of role) passes, a user without it gets 403, and SUPER_ADMIN always passes
(the implicit bypass in app.services.permissions.has_permission).

MANAGEMENT is used throughout as the "lacks it" baseline role -- its Phase 1
default permission set (VIEW_VACANCY, VIEW_CANDIDATES, VIEW_EMPLOYEES,
REPORTS, SETTINGS) doesn't include any of the write permissions exercised
here, so granting one directly via grant_permission isolates exactly what
require_permission() is doing, independent of role-based defaults already
covered by each router's own existing RBAC tests.
"""
from app.models.enums import PermissionEnum, UserRoleEnum

from tests.conftest import auth_headers


def _create_submitted_vr(client, department_factory, user_factory, campus_code="SSE"):
    department = department_factory(campus_code)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code=campus_code)
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
            "priority": "HIGH",
        },
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    return vr_id


def _create_approved_vr(client, department_factory, user_factory, campus_code="SSE"):
    vr_id = _create_submitted_vr(client, department_factory, user_factory, campus_code)
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)  # override-capable, skips the Dean stage
    client.post(f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, super_admin))
    return vr_id


# --- vacancy_requests.py -----------------------------------------------------


def test_reject_vacancy_requires_reject_vacancy_permission(
    client, user_factory, department_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vr_id = _create_submitted_vr(client, department_factory, user_factory)
    denied = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject", headers=auth_headers(client, mgmt), json={"reason": "x"}
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.REJECT_VACANCY)
    vr_id2 = _create_submitted_vr(client, department_factory, user_factory)
    allowed = client.post(
        f"/api/v1/vacancy-requests/{vr_id2}/reject", headers=auth_headers(client, mgmt), json={"reason": "x"}
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id3 = _create_submitted_vr(client, department_factory, user_factory)
    admin_ok = client.post(
        f"/api/v1/vacancy-requests/{vr_id3}/reject", headers=auth_headers(client, admin), json={"reason": "x"}
    )
    assert admin_ok.status_code == 200


def test_publish_vacancy_requires_publish_vacancy_permission(
    client, user_factory, department_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vr_id = _create_approved_vr(client, department_factory, user_factory)
    denied = client.post(f"/api/v1/vacancy-requests/{vr_id}/publish", headers=auth_headers(client, mgmt))
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.PUBLISH_VACANCY)
    vr_id2 = _create_approved_vr(client, department_factory, user_factory)
    allowed = client.post(f"/api/v1/vacancy-requests/{vr_id2}/publish", headers=auth_headers(client, mgmt))
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id3 = _create_approved_vr(client, department_factory, user_factory)
    admin_ok = client.post(f"/api/v1/vacancy-requests/{vr_id3}/publish", headers=auth_headers(client, admin))
    assert admin_ok.status_code == 200


def test_close_vacancy_requires_close_vacancy_permission(
    client, user_factory, published_vacancy_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    denied = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, mgmt)
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.CLOSE_VACANCY)
    vacancy2 = published_vacancy_factory(slot_count=1)
    allowed = client.post(
        f"/api/v1/vacancy-requests/{vacancy2.vacancy_request.id}/close", headers=auth_headers(client, mgmt)
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy3 = published_vacancy_factory(slot_count=1)
    admin_ok = client.post(
        f"/api/v1/vacancy-requests/{vacancy3.vacancy_request.id}/close", headers=auth_headers(client, admin)
    )
    assert admin_ok.status_code == 200


def test_cancel_vacancy_requires_cancel_vacancy_permission(
    client, user_factory, published_vacancy_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    denied = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, mgmt),
        json={"reason": "Budget freeze"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.CANCEL_VACANCY)
    vacancy2 = published_vacancy_factory(slot_count=1)
    allowed = client.post(
        f"/api/v1/vacancy-requests/{vacancy2.vacancy_request.id}/cancel",
        headers=auth_headers(client, mgmt),
        json={"reason": "Budget freeze"},
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy3 = published_vacancy_factory(slot_count=1)
    admin_ok = client.post(
        f"/api/v1/vacancy-requests/{vacancy3.vacancy_request.id}/cancel",
        headers=auth_headers(client, admin),
        json={"reason": "Budget freeze"},
    )
    assert admin_ok.status_code == 200


# --- vacancy_requests.py collision regression: dean-approve/hr-approve/slot-count
# were deliberately NOT cut over -- a bare APPROVE_VACANCY grant must not let
# a non-Dean/HR role through them.


def test_associate_dean_default_approve_vacancy_permission_cannot_hr_approve(
    client, user_factory, department_factory
):
    # ASSOCIATE_DEAN_RECRUITMENT's Phase 1 default permission set includes
    # APPROVE_VACANCY (for their own dean-approve action) -- confirm this
    # does NOT let them through hr-approve, which stays role/capability-gated
    # (HR_ADMIN/SUPER_ADMIN only), not permission-gated, specifically to
    # avoid this collision. See vacancy_requests.py's module notes.
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    vr_id = _create_submitted_vr(client, department_factory, user_factory)
    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))

    hr_approve_response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, dean)
    )
    assert hr_approve_response.status_code == 403


# --- candidates.py -----------------------------------------------------------


def test_create_candidate_requires_create_candidate_permission(client, user_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    denied = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, mgmt),
        json={"full_name": "Denied Candidate", "email": "denied.candidate@example.com"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.CREATE_CANDIDATE)
    allowed = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, mgmt),
        json={"full_name": "Allowed Candidate", "email": "allowed.candidate@example.com"},
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.post(
        "/api/v1/candidates",
        headers=auth_headers(client, admin),
        json={"full_name": "Admin Candidate", "email": "admin.candidate@example.com"},
    )
    assert admin_ok.status_code == 201


def test_update_candidate_requires_edit_candidate_permission(client, user_factory, candidate_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    candidate = candidate_factory()
    denied = client.patch(
        f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, mgmt), json={"full_name": "New Name"}
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.EDIT_CANDIDATE)
    allowed = client.patch(
        f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, mgmt), json={"full_name": "New Name 2"}
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.patch(
        f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, admin), json={"full_name": "New Name 3"}
    )
    assert admin_ok.status_code == 200


# --- applications.py ----------------------------------------------------------


def test_create_application_requires_manage_applications_permission(
    client, user_factory, published_vacancy_factory, candidate_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=3)
    candidate1 = candidate_factory()
    denied = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, mgmt),
        json={"candidate_id": str(candidate1.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.MANAGE_APPLICATIONS)
    candidate2 = candidate_factory()
    allowed = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, mgmt),
        json={"candidate_id": str(candidate2.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    candidate3 = candidate_factory()
    admin_ok = client.post(
        "/api/v1/applications",
        headers=auth_headers(client, admin),
        json={"candidate_id": str(candidate3.id), "job_posting_id": str(vacancy.job_posting.id)},
    )
    assert admin_ok.status_code == 201


# --- interviews.py -------------------------------------------------------------


def _iso_future(minutes: int = 60) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def test_schedule_interview_requires_schedule_interview_permission(
    client, user_factory, published_vacancy_factory, application_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code=vacancy.campus.code)
    application1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    denied = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, mgmt),
        json={
            "application_id": str(application1.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.SCHEDULE_INTERVIEW)
    application2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    allowed = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, mgmt),
        json={
            "application_id": str(application2.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    application3 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    admin_ok = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, admin),
        json={
            "application_id": str(application3.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert admin_ok.status_code == 201


def _schedule_interview(client, actor, application, panel_member):
    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, actor),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": _iso_future(),
            "panel_member_ids": [str(panel_member.id)],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_reschedule_interview_requires_reschedule_interview_permission(
    client, user_factory, published_vacancy_factory, application_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code=vacancy.campus.code)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interview_id = _schedule_interview(client, vacancy.hr_admin, application, panel_member)

    denied = client.patch(
        f"/api/v1/interviews/{interview_id}",
        headers=auth_headers(client, mgmt),
        json={"scheduled_at": _iso_future(120)},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.RESCHEDULE_INTERVIEW)
    allowed = client.patch(
        f"/api/v1/interviews/{interview_id}",
        headers=auth_headers(client, mgmt),
        json={"scheduled_at": _iso_future(180)},
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.patch(
        f"/api/v1/interviews/{interview_id}",
        headers=auth_headers(client, admin),
        json={"scheduled_at": _iso_future(240)},
    )
    assert admin_ok.status_code == 200


def test_cancel_interview_requires_cancel_interview_permission(
    client, user_factory, published_vacancy_factory, application_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code=vacancy.campus.code)

    application1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interview_id1 = _schedule_interview(client, vacancy.hr_admin, application1, panel_member)
    denied = client.patch(
        f"/api/v1/interviews/{interview_id1}", headers=auth_headers(client, mgmt), json={"status": "CANCELLED"}
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.CANCEL_INTERVIEW)
    application2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interview_id2 = _schedule_interview(client, vacancy.hr_admin, application2, panel_member)
    allowed = client.patch(
        f"/api/v1/interviews/{interview_id2}", headers=auth_headers(client, mgmt), json={"status": "CANCELLED"}
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    application3 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interview_id3 = _schedule_interview(client, vacancy.hr_admin, application3, panel_member)
    admin_ok = client.patch(
        f"/api/v1/interviews/{interview_id3}", headers=auth_headers(client, admin), json={"status": "CANCELLED"}
    )
    assert admin_ok.status_code == 200


def test_submit_interview_feedback_requires_mark_interview_completed_permission(
    client, user_factory, published_vacancy_factory, application_factory
):
    # MARK_INTERVIEW_COMPLETED is INTERVIEW_PANEL_MEMBER-only by Phase 1
    # default -- unlike the other interview permissions above, there's no
    # sensible "grant it to MANAGEMENT" story here since submit_feedback
    # also requires being an assigned panel member (a separate, deliberate
    # check in app.services.interviews.submit_feedback, not just the
    # require_permission gate) -- so this test exercises the 403/200 split
    # via role instead, mirroring the plain require_roles it replaced.
    vacancy = published_vacancy_factory(slot_count=1)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code=vacancy.campus.code)
    other_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code=vacancy.campus.code)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interview_id = _schedule_interview(client, vacancy.hr_admin, application, panel_member)

    denied = client.post(
        f"/api/v1/interviews/{interview_id}/feedback",
        headers=auth_headers(client, other_officer),
        json={"overall_recommendation": "HIRE", "comments": "Good"},
    )
    assert denied.status_code == 403

    allowed = client.post(
        f"/api/v1/interviews/{interview_id}/feedback",
        headers=auth_headers(client, panel_member),
        json={"overall_recommendation": "HIRE", "comments": "Good"},
    )
    assert allowed.status_code == 201


# --- job_distribution.py -------------------------------------------------------


def test_get_job_ad_requires_job_distribution_permission(
    client, user_factory, published_vacancy_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    denied = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, mgmt)
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.JOB_DISTRIBUTION)
    allowed = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, mgmt)
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, admin)
    )
    assert admin_ok.status_code == 200


# --- resume_screening.py --------------------------------------------------------


def test_screen_application_requires_resume_screening_permission(
    client, user_factory, published_vacancy_factory, application_factory, candidate_factory, grant_permission
):
    from tests.conftest import build_test_pdf

    def _upload(candidate_id, actor):
        pdf_bytes = build_test_pdf(
            "Experienced software engineer and educator with a PhD. Ten years of "
            "combined industry and academic teaching experience, including "
            "curriculum design and published research. Proficient in Python, "
            "teaching, mentoring, and research supervision."
        )
        response = client.post(
            f"/api/v1/candidates/{candidate_id}/resume",
            headers=auth_headers(client, actor),
            files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 200, response.text

    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=1)
    candidate1 = candidate_factory(phone_number="+91 9876543210")
    _upload(candidate1.id, vacancy.hr_admin)
    application1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate1)

    denied = client.post(
        f"/api/v1/applications/{application1.id}/screen", headers=auth_headers(client, mgmt)
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.RESUME_SCREENING)
    candidate2 = candidate_factory(phone_number="+91 9876543211")
    _upload(candidate2.id, vacancy.hr_admin)
    application2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate2)
    allowed = client.post(
        f"/api/v1/applications/{application2.id}/screen", headers=auth_headers(client, mgmt)
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    candidate3 = candidate_factory(phone_number="+91 9876543212")
    _upload(candidate3.id, vacancy.hr_admin)
    application3 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate3)
    admin_ok = client.post(
        f"/api/v1/applications/{application3.id}/screen", headers=auth_headers(client, admin)
    )
    assert admin_ok.status_code == 200


# --- offers.py -------------------------------------------------------------------


def test_create_offer_requires_offers_permission(
    client, user_factory, published_vacancy_factory, application_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=3)
    application1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    denied = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, mgmt),
        json={"application_id": str(application1.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.OFFERS)
    application2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    allowed = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, mgmt),
        json={"application_id": str(application2.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    application3 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    admin_ok = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, admin),
        json={"application_id": str(application3.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    )
    assert admin_ok.status_code == 201


def test_recruitment_officer_default_permissions_cannot_hit_offers(client, user_factory, published_vacancy_factory, application_factory):
    # Regression check: RECRUITMENT_OFFICER's Phase 1 default permission set
    # does NOT include OFFERS (only HR_ADMIN does) -- offers.py's write
    # endpoints must stay HR_ADMIN/SUPER_ADMIN only.
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    response = client.post(
        "/api/v1/offers",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"application_id": str(application.id), "salary_amount": 60000, "joining_date": "2026-09-01"},
    )
    assert response.status_code == 403


# --- employees.py ----------------------------------------------------------------


def test_offboard_employee_requires_edit_employees_permission(
    client, user_factory, published_vacancy_factory, hired_employee_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    vacancy = published_vacancy_factory(slot_count=3)
    hired1 = hired_employee_factory(vacancy)
    denied = client.post(
        f"/api/v1/employees/{hired1.employee.id}/offboard",
        headers=auth_headers(client, mgmt),
        json={"separation_type": "RESIGNED", "separation_date": "2026-09-01", "reason": "Resigned"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.EDIT_EMPLOYEES)
    hired2 = hired_employee_factory(vacancy)
    allowed = client.post(
        f"/api/v1/employees/{hired2.employee.id}/offboard",
        headers=auth_headers(client, mgmt),
        json={"separation_type": "RESIGNED", "separation_date": "2026-09-01", "reason": "Resigned"},
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hired3 = hired_employee_factory(vacancy)
    admin_ok = client.post(
        f"/api/v1/employees/{hired3.employee.id}/offboard",
        headers=auth_headers(client, admin),
        json={"separation_type": "RESIGNED", "separation_date": "2026-09-01", "reason": "Resigned"},
    )
    assert admin_ok.status_code == 200


# --- users.py ----------------------------------------------------------------------


def test_create_user_requires_manage_users_permission(client, user_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    denied = client.post(
        "/api/v1/users",
        headers=auth_headers(client, mgmt),
        json={
            "email": "denied.newuser@example.com",
            "password": "SomePass123!",
            "full_name": "Denied New User",
            "role": "CANDIDATE",
        },
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.MANAGE_USERS)
    allowed = client.post(
        "/api/v1/users",
        headers=auth_headers(client, mgmt),
        json={
            "email": "allowed.newuser@example.com",
            "password": "SomePass123!",
            "full_name": "Allowed New User",
            "role": "CANDIDATE",
        },
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "admin.newuser@example.com",
            "password": "SomePass123!",
            "full_name": "Admin New User",
            "role": "CANDIDATE",
        },
    )
    assert admin_ok.status_code == 201


# --- departments.py / locations.py / campuses.py ------------------------------------


def test_create_department_requires_manage_departments_permission(
    client, user_factory, campus_factory, grant_permission
):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    sse = campus_factory("SSE")
    denied = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, mgmt),
        json={"campus_id": str(sse.id), "name": "Denied Department"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.MANAGE_DEPARTMENTS)
    allowed = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, mgmt),
        json={"campus_id": str(sse.id), "name": "Allowed Department"},
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.post(
        "/api/v1/departments",
        headers=auth_headers(client, admin),
        json={"campus_id": str(sse.id), "name": "Admin Department"},
    )
    assert admin_ok.status_code == 201


def test_create_location_requires_manage_locations_permission(client, user_factory, campus_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    sse = campus_factory("SSE")
    denied = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, mgmt),
        json={"campus_id": str(sse.id), "name": "Denied Block"},
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.MANAGE_LOCATIONS)
    allowed = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, mgmt),
        json={"campus_id": str(sse.id), "name": "Allowed Block"},
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, admin),
        json={"campus_id": str(sse.id), "name": "Admin Block"},
    )
    assert admin_ok.status_code == 201


def test_create_campus_requires_manage_campuses_permission(client, user_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    denied = client.post(
        "/api/v1/campuses", headers=auth_headers(client, mgmt), json={"code": "STUDIO", "name": "Studio Campus"}
    )
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.MANAGE_CAMPUSES)
    allowed = client.post(
        "/api/v1/campuses", headers=auth_headers(client, mgmt), json={"code": "STUDIO", "name": "Studio Campus"}
    )
    assert allowed.status_code == 201

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.post(
        "/api/v1/campuses", headers=auth_headers(client, admin), json={"code": "SPIER", "name": "Spier Campus"}
    )
    assert admin_ok.status_code == 201


# --- audit_logs.py -------------------------------------------------------------------


def test_list_audit_logs_requires_activity_log_permission(client, user_factory, grant_permission):
    mgmt = user_factory(UserRoleEnum.MANAGEMENT)
    denied = client.get("/api/v1/audit-logs", headers=auth_headers(client, mgmt))
    assert denied.status_code == 403

    grant_permission(mgmt, PermissionEnum.ACTIVITY_LOG)
    allowed = client.get("/api/v1/audit-logs", headers=auth_headers(client, mgmt))
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.get("/api/v1/audit-logs", headers=auth_headers(client, admin))
    assert admin_ok.status_code == 200


def test_recruitment_officer_default_permissions_cannot_hit_audit_logs(client, user_factory):
    # Regression check: RECRUITMENT_OFFICER's Phase 1 default permission set
    # does NOT include ACTIVITY_LOG (only SUPER_ADMIN/HR_ADMIN/
    # ASSOCIATE_DEAN_RECRUITMENT/CAMPUS_HOD do) -- must stay 403.
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    response = client.get("/api/v1/audit-logs", headers=auth_headers(client, officer))
    assert response.status_code == 403


# --- reports.py / dashboard.py --------------------------------------------------------


def test_get_report_requires_reports_permission(client, user_factory):
    # Every real non-CANDIDATE role's Phase 1 default already includes
    # REPORTS -- this is a zero-regression tightening over the old
    # CANDIDATE-only-blocking gate. CANDIDATE (no grants at all) must still
    # be blocked; any staff role (e.g. INTERVIEW_PANEL_MEMBER, which has no
    # other write permissions at all) must still pass.
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    denied = client.get(
        "/api/v1/reports/recruitment-funnel", headers=auth_headers(client, candidate_user)
    )
    assert denied.status_code == 403

    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    allowed = client.get(
        "/api/v1/reports/recruitment-funnel", headers=auth_headers(client, panel_member)
    )
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.get("/api/v1/reports/recruitment-funnel", headers=auth_headers(client, admin))
    assert admin_ok.status_code == 200


def test_get_dashboard_kpis_requires_settings_permission(client, user_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    denied = client.get("/api/v1/dashboard/kpis", headers=auth_headers(client, candidate_user))
    assert denied.status_code == 403

    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    allowed = client.get("/api/v1/dashboard/kpis", headers=auth_headers(client, panel_member))
    assert allowed.status_code == 200

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    admin_ok = client.get("/api/v1/dashboard/kpis", headers=auth_headers(client, admin))
    assert admin_ok.status_code == 200
