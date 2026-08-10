"""Tests for the additive GET /api/v1/departments/vacancy-register endpoint
(app/api/v1/routers/vacancy_register.py, app/services/vacancy_register.py).
"""

import uuid
from datetime import datetime, timezone

from app.models.enums import EmploymentTypeEnum, InterviewTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.vacancy_request import VacancyRequest
from app.services import interviews as interviews_service
from app.services import vacancy_workflow

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/departments/vacancy-register"


def _list(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def _make_vr(db_session, campus, department, hod, requested_count: int = 1, position_title: str | None = None):
    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title=position_title or f"Role-{uuid.uuid4().hex[:6]}",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=requested_count,
        qualification="PhD",
        experience_required="1 year",
        requested_by_id=hod.id,
    )
    db_session.add(vr)
    db_session.flush()
    return vr


def test_active_employee_no_requests_is_fully_staffed(
    client, published_vacancy_factory, hired_employee_factory, department_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    # Re-home the employee to a department that never had a VacancyRequest of
    # its own -- exactly the "employee working, no requests raised for this
    # department" scenario the spec calls for.
    other_dept = department_factory("SSE", name=f"No-Request Dept {uuid.uuid4().hex[:6]}")
    hired.employee.department_id = other_dept.id
    db_session.flush()

    response = _list(client, vacancy.hr_admin, department_id=str(other_dept.id))
    assert response.status_code == 200, response.text
    row = response.json()["items"][0]
    assert row["working_count"] == 1
    assert row["vacancy_count"] == 0
    assert row["approved_count"] == 1
    assert row["filled_pct"] == 100.0
    assert row["recruitment_status"] == "FULLY_STAFFED"
    assert row["approval_status"] == "NO_REQUESTS"


def test_approved_not_published_vacancy_counts_full_positions(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Approved-Unpublished {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    vr = _make_vr(db_session, campus, department, hod, requested_count=2)
    vacancy_workflow.submit(db_session, vr, hod, None)
    vacancy_workflow.dean_approve(db_session, vr, dean, None)
    vacancy_workflow.hr_approve(db_session, vr, hr_admin, None)

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    # requested_count counts VacancyRequest *rows* raised for this department
    # (there's exactly one, requesting 2 positions) -- not the sum of their
    # requested_count fields.
    assert row["requested_count"] == 1
    assert row["vacancy_count"] == 2
    assert row["working_count"] == 0
    assert row["approved_count"] == 2
    assert row["filled_pct"] == 0.0
    assert row["recruitment_status"] == "VACANCY_EXISTS"
    assert row["approval_status"] == "APPROVED"


def test_published_vacancy_partial_fill_vacancy_count_excludes_filled_slot(
    client, published_vacancy_factory, hired_employee_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=3)
    hired_employee_factory(vacancy)

    response = _list(client, vacancy.hr_admin, department_id=str(vacancy.department.id))
    row = response.json()["items"][0]
    assert row["working_count"] == 1
    assert row["vacancy_count"] == 2
    assert row["approved_count"] == 3
    assert row["recruitment_status"] == "VACANCY_EXISTS"


def test_submitted_vacancy_request_is_approval_pending(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Pending {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    vr = _make_vr(db_session, campus, department, hod)
    vacancy_workflow.submit(db_session, vr, hod, None)

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    assert row["approval_status"] == "APPROVAL_PENDING"


def test_most_recent_rejected_vacancy_request_is_rejected(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Rejected {uuid.uuid4().hex[:6]}")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    vr = _make_vr(db_session, campus, department, hod)
    vacancy_workflow.submit(db_session, vr, hod, None)
    vacancy_workflow.reject(db_session, vr, dean, "Not needed anymore", None)

    response = _list(client, hr_admin, department_id=str(department.id))
    row = response.json()["items"][0]
    assert row["approval_status"] == "REJECTED"


def test_pipeline_counts_independent_no_fanout(
    client, published_vacancy_factory, hired_employee_factory, application_factory, user_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)

    # Extra pending request in the same department -- counts toward
    # requested_count only, not approved_request_count.
    extra_vr = _make_vr(db_session, vacancy.campus, vacancy.department, vacancy.hod)
    vacancy_workflow.submit(db_session, extra_vr, vacancy.hod, None)

    hired = hired_employee_factory(vacancy)

    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    # Two interview rows against the same (already-hired) application -- must
    # not inflate offers_count/joined_count via a join fan-out.
    for _ in range(2):
        interviews_service.schedule_interview(
            db_session,
            application=hired.application,
            interview_type=InterviewTypeEnum.TECHNICAL,
            scheduled_at=datetime.now(timezone.utc),
            duration_minutes=30,
            meeting_link=None,
            location=None,
            notes=None,
            panel_member_ids=[panel_member.id],
            actor=vacancy.hr_admin,
        )

    second_application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    interviews_service.schedule_interview(
        db_session,
        application=second_application,
        interview_type=InterviewTypeEnum.HR,
        scheduled_at=datetime.now(timezone.utc),
        duration_minutes=30,
        meeting_link=None,
        location=None,
        notes=None,
        panel_member_ids=[panel_member.id],
        actor=vacancy.hr_admin,
    )

    response = _list(client, vacancy.hr_admin, department_id=str(vacancy.department.id))
    row = response.json()["items"][0]
    assert row["requested_count"] == 2
    assert row["approved_request_count"] == 1
    assert row["jd_posted_count"] == 1
    assert row["interviews_count"] == 3
    assert row["offers_count"] == 1
    assert row["joined_count"] == 1


def test_pagination(client, campus_factory, department_factory, user_factory):
    campus_factory("SPIER")
    department_factory("SPIER", name="Alpha Dept")
    department_factory("SPIER", name="Beta Dept")
    department_factory("SPIER", name="Gamma Dept")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    page1 = _list(client, hr_admin, campus_code="SPIER", limit=2, offset=0, sort_by="department_name", sort_dir="asc")
    body1 = page1.json()
    assert body1["total"] == 3
    assert [r["department_name"] for r in body1["items"]] == ["Alpha Dept", "Beta Dept"]

    page2 = _list(client, hr_admin, campus_code="SPIER", limit=2, offset=2, sort_by="department_name", sort_dir="asc")
    assert [r["department_name"] for r in page2.json()["items"]] == ["Gamma Dept"]


def test_sort_by_vacancy_count_desc_reorders(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus = campus_factory("SPIER")
    dept_low = department_factory("SPIER", name="Low Vacancy Dept")
    dept_high = department_factory("SPIER", name="High Vacancy Dept")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    vr = _make_vr(db_session, campus, dept_high, hod, requested_count=5)
    vacancy_workflow.submit(db_session, vr, hod, None)
    vacancy_workflow.dean_approve(db_session, vr, dean, None)
    vacancy_workflow.hr_approve(db_session, vr, hr_admin, None)

    asc = _list(client, hr_admin, campus_code="SPIER", sort_by="vacancy_count", sort_dir="asc")
    desc = _list(client, hr_admin, campus_code="SPIER", sort_by="vacancy_count", sort_dir="desc")

    asc_names = [r["department_name"] for r in asc.json()["items"]]
    desc_names = [r["department_name"] for r in desc.json()["items"]]
    assert asc_names[-1] == "High Vacancy Dept"
    assert desc_names[0] == "High Vacancy Dept"
    assert dept_low.name in asc_names and dept_low.name in desc_names


def test_category_filter(client, campus_factory, department_factory, user_factory, db_session):
    campus_factory("SPIER")
    teaching_dept = department_factory("SPIER", name="Teaching Dept")
    teaching_dept.category = StaffRoleCategoryEnum.TEACHING
    non_teaching_dept = department_factory("SPIER", name="NonTeaching Dept")
    non_teaching_dept.category = StaffRoleCategoryEnum.NON_TEACHING
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _list(client, hr_admin, campus_code="SPIER", category="TEACHING")
    names = {r["department_name"] for r in response.json()["items"]}
    assert names == {"Teaching Dept"}


def test_category_counts_reflect_full_set_regardless_of_selected_category(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus_factory("SPIER")
    teaching_dept = department_factory("SPIER", name="Counts Teaching Dept")
    teaching_dept.category = StaffRoleCategoryEnum.TEACHING
    non_teaching_dept_1 = department_factory("SPIER", name="Counts NonTeaching Dept 1")
    non_teaching_dept_1.category = StaffRoleCategoryEnum.NON_TEACHING
    non_teaching_dept_2 = department_factory("SPIER", name="Counts NonTeaching Dept 2")
    non_teaching_dept_2.category = StaffRoleCategoryEnum.NON_TEACHING
    housekeeping_dept = department_factory("SPIER", name="Counts Housekeeping Dept")
    housekeeping_dept.category = StaffRoleCategoryEnum.HOUSEKEEPING
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    unfiltered = _list(client, hr_admin, campus_code="SPIER", search="Counts").json()
    expected_counts = {"TEACHING": 1, "NON_TEACHING": 2, "HOUSEKEEPING": 1, "ALL": 4}
    assert unfiltered["category_counts"] == expected_counts
    assert unfiltered["total"] == 4

    # Narrowing items/total via the category filter must NOT change
    # category_counts -- the whole point is that switching tabs doesn't make
    # the other tabs' displayed counts collapse.
    teaching_only = _list(client, hr_admin, campus_code="SPIER", search="Counts", category="TEACHING").json()
    assert teaching_only["total"] == 1
    assert {r["department_name"] for r in teaching_only["items"]} == {"Counts Teaching Dept"}
    assert teaching_only["category_counts"] == expected_counts

    housekeeping_only = _list(
        client, hr_admin, campus_code="SPIER", search="Counts", category="HOUSEKEEPING"
    ).json()
    assert housekeeping_only["total"] == 1
    assert housekeeping_only["category_counts"] == expected_counts


def test_is_active_filter_defaults_to_no_filter_but_can_narrow_either_way(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus_factory("SPIER")
    active_dept = department_factory("SPIER", name="Active Dept")
    inactive_dept = department_factory("SPIER", name="Inactive Dept")
    inactive_dept.is_active = False
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    # No is_active param at all -- both rows returned (matches
    # designations.py's own is_active=None-means-no-filter convention).
    all_names = {r["department_name"] for r in _list(client, hr_admin, campus_code="SPIER").json()["items"]}
    assert all_names == {"Active Dept", "Inactive Dept"}

    active_only = _list(client, hr_admin, campus_code="SPIER", is_active=True).json()["items"]
    assert {r["department_name"] for r in active_only} == {"Active Dept"}
    assert active_only[0]["is_active"] is True

    inactive_only = _list(client, hr_admin, campus_code="SPIER", is_active=False).json()["items"]
    assert {r["department_name"] for r in inactive_only} == {"Inactive Dept"}
    assert inactive_only[0]["is_active"] is False


def test_department_id_filter(client, campus_factory, department_factory, user_factory):
    campus_factory("SPIER")
    dept_a = department_factory("SPIER", name="Dept A")
    department_factory("SPIER", name="Dept B")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _list(client, hr_admin, campus_code="SPIER", department_id=str(dept_a.id))
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["department_id"] == str(dept_a.id)


def test_search_filter_matches_employee_fields(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    response = _list(client, vacancy.hr_admin, search=hired.employee.employee_code)
    names = {r["department_name"] for r in response.json()["items"]}
    assert vacancy.department.name in names


def test_approval_status_filter(client, campus_factory, department_factory, user_factory, db_session):
    campus = campus_factory("SPIER")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    dept_none = department_factory("SPIER", name="No Requests Dept")

    dept_pending = department_factory("SPIER", name="Pending Dept")
    vr_pending = _make_vr(db_session, campus, dept_pending, hod)
    vacancy_workflow.submit(db_session, vr_pending, hod, None)

    dept_rejected = department_factory("SPIER", name="Rejected Dept")
    vr_rejected = _make_vr(db_session, campus, dept_rejected, hod)
    vacancy_workflow.submit(db_session, vr_rejected, hod, None)
    vacancy_workflow.reject(db_session, vr_rejected, dean, "Not needed", None)

    dept_approved = department_factory("SPIER", name="Approved Dept")
    vr_approved = _make_vr(db_session, campus, dept_approved, hod)
    vacancy_workflow.submit(db_session, vr_approved, hod, None)
    vacancy_workflow.dean_approve(db_session, vr_approved, dean, None)
    vacancy_workflow.hr_approve(db_session, vr_approved, hr_admin, None)

    assert {r["department_name"] for r in _list(client, hr_admin, campus_code="SPIER", approval_status="NO_REQUESTS").json()["items"]} == {
        "No Requests Dept"
    }
    assert {r["department_name"] for r in _list(client, hr_admin, campus_code="SPIER", approval_status="APPROVAL_PENDING").json()["items"]} == {
        "Pending Dept"
    }
    assert {r["department_name"] for r in _list(client, hr_admin, campus_code="SPIER", approval_status="REJECTED").json()["items"]} == {
        "Rejected Dept"
    }
    assert {r["department_name"] for r in _list(client, hr_admin, campus_code="SPIER", approval_status="APPROVED").json()["items"]} == {
        "Approved Dept"
    }
    assert dept_none.name  # keep reference alive / used


def test_recruitment_status_filter(client, campus_factory, department_factory, user_factory, db_session):
    campus = campus_factory("SPIER")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SPIER")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    department_factory("SPIER", name="No Activity Dept")

    dept_vacancy = department_factory("SPIER", name="Vacancy Exists Dept")
    vr = _make_vr(db_session, campus, dept_vacancy, hod)
    vacancy_workflow.submit(db_session, vr, hod, None)
    vacancy_workflow.dean_approve(db_session, vr, dean, None)
    vacancy_workflow.hr_approve(db_session, vr, hr_admin, None)

    assert {
        r["department_name"]
        for r in _list(client, hr_admin, campus_code="SPIER", recruitment_status="NO_ACTIVITY").json()["items"]
    } == {"No Activity Dept"}
    assert {
        r["department_name"]
        for r in _list(client, hr_admin, campus_code="SPIER", recruitment_status="VACANCY_EXISTS").json()["items"]
    } == {"Vacancy Exists Dept"}


def test_campus_code_filter_narrows_for_global_role(client, campus_factory, department_factory, user_factory):
    campus_factory("SSE")
    campus_factory("SCAD")
    department_factory("SSE", name="SSE Only Dept")
    department_factory("SCAD", name="SCAD Only Dept")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _list(client, hr_admin, campus_code="SSE")
    names = {r["department_name"] for r in response.json()["items"]}
    assert "SSE Only Dept" in names
    assert "SCAD Only Dept" not in names


def test_single_campus_role_ignores_requested_campus_code(client, campus_factory, department_factory, user_factory):
    campus_factory("SSE")
    campus_factory("SCAD")
    department_factory("SSE", name="HOD Home Dept")
    department_factory("SCAD", name="Other Campus Dept")
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = _list(client, hod_sse, campus_code="SCAD")
    names = {r["department_name"] for r in response.json()["items"]}
    assert "HOD Home Dept" in names
    assert "Other Campus Dept" not in names


def test_candidate_forbidden(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = _list(client, candidate)
    assert response.status_code == 403


def test_invalid_sort_by_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_by="not_a_field")
    assert response.status_code == 422


def test_invalid_sort_dir_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, sort_dir="sideways")
    assert response.status_code == 422


def test_invalid_approval_status_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, approval_status="BOGUS")
    assert response.status_code == 422


def test_invalid_recruitment_status_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _list(client, hr_admin, recruitment_status="BOGUS")
    assert response.status_code == 422
