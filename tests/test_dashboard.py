from datetime import date, datetime, timezone

from app.models.enums import (
    ApplicationStatusEnum,
    EmploymentStatusEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
    VacancyPriorityEnum,
)
from app.services import pipeline, vacancy_workflow

from tests.conftest import auth_headers


def _kpis(client, actor, **params):
    return client.get("/api/v1/dashboard/kpis", headers=auth_headers(client, actor), params=params)


def test_average_time_to_hire_days_is_exact(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    applied_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    joining_date = date(2026, 1, 15)  # exactly 14 days later
    hired_employee_factory(vacancy, applied_at=applied_at, joining_date=joining_date)

    response = _kpis(client, vacancy.hr_admin)
    assert response.status_code == 200
    assert response.json()["average_time_to_hire_days"] == 14.0


def test_no_completed_hires_gives_none_average(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _kpis(client, vacancy.hr_admin)
    assert response.json()["average_time_to_hire_days"] is None


def test_open_positions_and_offers_pending_counts(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _kpis(client, vacancy.hr_admin)
    body = response.json()
    assert body["open_positions"] == 2
    assert body["total_applications"] == 1
    assert body["offers_pending"] == 0


def test_hod_sees_only_own_campus(client, published_vacancy_factory, hired_employee_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    hired_employee_factory(vacancy_sse)
    hired_employee_factory(vacancy_scad)

    response = _kpis(client, vacancy_sse.hod)
    assert response.status_code == 200
    body = response.json()
    assert "home campus" in body["scope_note"]
    campus_codes = {row["campus_code"] for row in body["campus_wise_hiring"]}
    assert campus_codes == {"SSE"}


def test_global_caller_spans_all_campuses_and_can_narrow(client, published_vacancy_factory, hired_employee_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    hired_employee_factory(vacancy_sse)
    hired_employee_factory(vacancy_scad)

    all_response = _kpis(client, vacancy_sse.hr_admin)
    all_codes = {row["campus_code"] for row in all_response.json()["campus_wise_hiring"]}
    assert {"SSE", "SCAD"} <= all_codes

    narrowed_response = _kpis(client, vacancy_sse.hr_admin, campus_code="SCAD")
    narrowed_codes = {row["campus_code"] for row in narrowed_response.json()["campus_wise_hiring"]}
    assert narrowed_codes == {"SCAD"}


def test_role_category_filtering(client, published_vacancy_factory):
    vacancy_teaching = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING
    )
    published_vacancy_factory(campus_code="SSE", slot_count=3, role_category=StaffRoleCategoryEnum.NON_TEACHING)

    response = _kpis(client, vacancy_teaching.hr_admin, role_category="TEACHING")
    assert response.json()["open_positions"] == 1

    response = _kpis(client, vacancy_teaching.hr_admin, role_category="NON_TEACHING")
    assert response.json()["open_positions"] == 3


def test_vacancy_closure_rate_pct_exact(client, published_vacancy_factory, db_session):
    open_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    closed_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_workflow.close(
        db_session,
        closed_vacancy.vacancy_request,
        closed_vacancy.approved_vacancy,
        closed_vacancy.job_posting,
        closed_vacancy.hr_admin,
        None,
    )

    response = _kpis(client, open_vacancy.hr_admin)
    assert response.json()["vacancy_closure_rate_pct"] == 50.0


def test_vacancy_closure_rate_pct_none_when_nothing_approved(client, user_factory):
    """None (not 0.0) when there's no APPROVED-or-beyond vacancy request in
    scope to compute a rate from -- 0.0 used to misleadingly read as
    "confirmed zero closure rate" (CLAUDE.md B1)."""
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _kpis(client, hr_admin)
    assert response.json()["vacancy_closure_rate_pct"] is None


def test_campus_wise_hiring_includes_a_zero_activity_campus(client, campus_factory, user_factory):
    """A campus with zero hires/open-slots/in-progress-applications used to
    vanish from this table entirely rather than show a zero-filled row
    (CLAUDE.md B3) -- campus_id is NOT NULL on VacancyRequest, so nothing was
    ever actually nullable here; the disappearing-row symptom was real."""
    campus_factory("SPIER")  # exists, but genuinely has no activity at all
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _kpis(client, hr_admin)
    body = response.json()
    row = next((r for r in body["campus_wise_hiring"] if r["campus_code"] == "SPIER"), None)
    assert row is not None
    assert row == {"campus_code": "SPIER", "hired_count": 0, "open_count": 0, "in_progress_count": 0}


def _breakdown_row(body, role_category: str) -> dict:
    row = next(r for r in body["category_wise_breakdown"] if r["role_category"] == role_category)
    return row


def test_category_wise_breakdown_always_has_3_rows_with_correct_counts(
    client, published_vacancy_factory, application_factory, hired_employee_factory
):
    teaching_vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=2, role_category=StaffRoleCategoryEnum.TEACHING
    )
    non_teaching_vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=3, role_category=StaffRoleCategoryEnum.NON_TEACHING
    )
    application_factory(teaching_vacancy.job_posting, recorded_by=teaching_vacancy.hr_admin)
    application_factory(non_teaching_vacancy.job_posting, recorded_by=non_teaching_vacancy.hr_admin)
    application_factory(non_teaching_vacancy.job_posting, recorded_by=non_teaching_vacancy.hr_admin)
    hired_employee_factory(teaching_vacancy)

    response = _kpis(client, teaching_vacancy.hr_admin)
    assert response.status_code == 200
    body = response.json()

    role_categories = {row["role_category"] for row in body["category_wise_breakdown"]}
    assert role_categories == {"TEACHING", "NON_TEACHING", "HOUSEKEEPING"}

    teaching_row = _breakdown_row(body, "TEACHING")
    # +1 application from application_factory, +1 from hired_employee_factory's
    # own application -- both use the same teaching job posting.
    assert teaching_row["applications"] == 2
    # 2 slots requested, 1 filled by hired_employee_factory -> 1 still open.
    assert teaching_row["open_positions"] == 1
    assert teaching_row["hires"] == 1

    non_teaching_row = _breakdown_row(body, "NON_TEACHING")
    assert non_teaching_row["applications"] == 2
    assert non_teaching_row["open_positions"] == 3
    assert non_teaching_row["hires"] == 0

    housekeeping_row = _breakdown_row(body, "HOUSEKEEPING")
    assert housekeeping_row == {
        "role_category": "HOUSEKEEPING",
        "applications": 0,
        "open_positions": 0,
        "hires": 0,
    }


def test_category_wise_breakdown_ignores_the_endpoints_own_role_category_filter(
    client, published_vacancy_factory, application_factory
):
    """The KPI strip's role_category param narrows every other field, but
    category_wise_breakdown is meant to be an always-all-3-categories
    at-a-glance card -- it must keep showing NON_TEACHING's real count even
    when the caller narrowed the rest of the response to role_category=TEACHING."""
    teaching_vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING
    )
    non_teaching_vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.NON_TEACHING
    )
    application_factory(non_teaching_vacancy.job_posting, recorded_by=non_teaching_vacancy.hr_admin)

    response = _kpis(client, teaching_vacancy.hr_admin, role_category="TEACHING")
    assert response.status_code == 200
    body = response.json()

    # The top-line KPI strip is narrowed to TEACHING (0 applications).
    assert body["total_applications"] == 0
    # ...but the breakdown card still shows NON_TEACHING's real data.
    non_teaching_row = _breakdown_row(body, "NON_TEACHING")
    assert non_teaching_row["applications"] == 1
    assert non_teaching_row["open_positions"] == 1


def test_category_wise_breakdown_respects_campus_scope(
    client, published_vacancy_factory, application_factory, hired_employee_factory
):
    sse_vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING
    )
    scad_vacancy = published_vacancy_factory(
        campus_code="SCAD", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING
    )
    application_factory(sse_vacancy.job_posting, recorded_by=sse_vacancy.hr_admin)
    application_factory(scad_vacancy.job_posting, recorded_by=scad_vacancy.hr_admin)
    application_factory(scad_vacancy.job_posting, recorded_by=scad_vacancy.hr_admin)
    hired_employee_factory(scad_vacancy)

    response = _kpis(client, sse_vacancy.hod)
    assert response.status_code == 200
    body = response.json()
    assert "home campus" in body["scope_note"]

    teaching_row = _breakdown_row(body, "TEACHING")
    assert teaching_row["applications"] == 1
    assert teaching_row["open_positions"] == 1
    assert teaching_row["hires"] == 0


def test_invalid_campus_code_returns_422(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _kpis(client, vacancy.hr_admin, campus_code="ZZZZ")
    assert response.status_code == 422


def test_invalid_role_category_returns_422(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _kpis(client, vacancy.hr_admin, role_category="BOGUS")
    assert response.status_code == 422


def test_candidate_role_forbidden(client, user_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    response = _kpis(client, candidate_user)
    assert response.status_code == 403


# --- Phase I (glowing-zooming-hamming.md): sanctioned strength dashboard tile ---


def test_sanctioned_strength_totals_teaching_and_housekeeping(
    client,
    db_session,
    published_vacancy_factory,
    hired_employee_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
):
    # Teaching: approved=5, 1 live Employee at this (department, designation) -> working=1.
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING)
    teaching_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=teaching_designation,
        approved_strength=5,
        created_by=vacancy.hr_admin,
    )
    hired = hired_employee_factory(vacancy)
    hired.employee.designation_id = teaching_designation.id
    db_session.flush()
    db_session.commit()

    # Housekeeping: approved=3, 2 active HousekeepingStaff -> working=2 (via
    # working_count_for's HOUSEKEEPING branch, not the always-empty Employee count).
    hk_department = vacancy.department  # campus/department reuse is fine, category lives on the designation
    hk_location = location_factory("SSE")
    hk_designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=hk_department)
    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=hk_department,
        designation=hk_designation,
        approved_strength=3,
        created_by=vacancy.hr_admin,
        location_id=hk_location.id,
    )
    housekeeping_staff_factory(
        campus=vacancy.campus, designation=hk_designation, location=hk_location, created_by=vacancy.hr_admin
    )
    housekeeping_staff_factory(
        campus=vacancy.campus, designation=hk_designation, location=hk_location, created_by=vacancy.hr_admin
    )
    db_session.commit()

    response = _kpis(client, vacancy.hr_admin)
    assert response.status_code == 200
    body = response.json()
    assert body["sanctioned_approved_total"] == 8
    assert body["sanctioned_working_total"] == 3
    assert body["sanctioned_vacancy_total"] == 5


def test_sanctioned_strength_vacancy_total_is_signed_not_floored(
    client,
    db_session,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    user_factory,
    sanctioned_strength_factory,
    housekeeping_staff_factory,
):
    """One overstaffed row (working > approved) and one understaffed row --
    the net total must reflect the overstaffed row's negative contribution,
    not have it floored at 0 before summing (which would overstate the
    aggregate: max(2-5,0) + max(5-1,0) = 0 + 4 = 4, vs the honest 7-6=1)."""
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    overstaffed_location = location_factory("SSE")
    overstaffed_designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=overstaffed_designation,
        approved_strength=2,
        created_by=hr_admin,
        location_id=overstaffed_location.id,
    )
    for _ in range(5):
        housekeeping_staff_factory(
            campus=campus, designation=overstaffed_designation, location=overstaffed_location, created_by=hr_admin
        )

    understaffed_location = location_factory("SSE")
    understaffed_designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=understaffed_designation,
        approved_strength=5,
        created_by=hr_admin,
        location_id=understaffed_location.id,
    )
    housekeeping_staff_factory(
        campus=campus, designation=understaffed_designation, location=understaffed_location, created_by=hr_admin
    )
    db_session.commit()

    response = _kpis(client, hr_admin)
    assert response.status_code == 200
    body = response.json()
    assert body["sanctioned_approved_total"] == 7
    assert body["sanctioned_working_total"] == 6
    assert body["sanctioned_vacancy_total"] == 1  # not 4, the floor-per-row-then-sum figure


def test_sanctioned_strength_totals_respect_role_category_filter(
    client,
    db_session,
    published_vacancy_factory,
    hired_employee_factory,
    designation_factory,
    sanctioned_strength_factory,
    location_factory,
    housekeeping_staff_factory,
):
    """Unlike category_wise_breakdown, these three totals narrow with the
    endpoint's own role_category filter."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.TEACHING)
    teaching_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=teaching_designation,
        approved_strength=5,
        created_by=vacancy.hr_admin,
    )
    hired = hired_employee_factory(vacancy)
    hired.employee.designation_id = teaching_designation.id
    db_session.flush()

    hk_location = location_factory("SSE")
    hk_designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=vacancy.department)
    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=hk_designation,
        approved_strength=3,
        created_by=vacancy.hr_admin,
        location_id=hk_location.id,
    )
    housekeeping_staff_factory(
        campus=vacancy.campus, designation=hk_designation, location=hk_location, created_by=vacancy.hr_admin
    )
    housekeeping_staff_factory(
        campus=vacancy.campus, designation=hk_designation, location=hk_location, created_by=vacancy.hr_admin
    )
    db_session.commit()

    teaching_response = _kpis(client, vacancy.hr_admin, role_category="TEACHING")
    teaching_body = teaching_response.json()
    assert teaching_body["sanctioned_approved_total"] == 5
    assert teaching_body["sanctioned_working_total"] == 1
    assert teaching_body["sanctioned_vacancy_total"] == 4

    housekeeping_response = _kpis(client, vacancy.hr_admin, role_category="HOUSEKEEPING")
    housekeeping_body = housekeeping_response.json()
    assert housekeeping_body["sanctioned_approved_total"] == 3
    assert housekeeping_body["sanctioned_working_total"] == 2
    assert housekeeping_body["sanctioned_vacancy_total"] == 1


def test_sanctioned_strength_totals_respect_campus_scope(
    client,
    db_session,
    campus_factory,
    department_factory,
    designation_factory,
    user_factory,
    sanctioned_strength_factory,
):
    """A non-global role's totals never include another campus's
    SanctionedStrength rows."""
    sse_campus = campus_factory("SSE")
    sse_department = department_factory("SSE")
    sse_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=sse_department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=sse_campus,
        department=sse_department,
        designation=sse_designation,
        approved_strength=5,
        created_by=hr_admin,
    )

    scad_campus = campus_factory("SCAD")
    scad_department = department_factory("SCAD")
    scad_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=scad_department)
    sanctioned_strength_factory(
        campus=scad_campus,
        department=scad_department,
        designation=scad_designation,
        approved_strength=9,
        created_by=hr_admin,
    )
    db_session.commit()

    sse_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _kpis(client, sse_hod)
    assert response.status_code == 200
    body = response.json()
    assert "home campus" in body["scope_note"]
    assert body["sanctioned_approved_total"] == 5
    assert body["sanctioned_working_total"] == 0
    assert body["sanctioned_vacancy_total"] == 5

    # A global caller (HR_ADMIN) sees both campuses' rows summed together.
    global_response = _kpis(client, hr_admin)
    global_body = global_response.json()
    assert global_body["sanctioned_approved_total"] == 14


# --- Step 3 (dashboard-kpi-additions-backend): 5 additive KPI fields ---


def test_urgent_vacancy_count_excludes_closed_rejected_cancelled_and_non_urgent(
    client, published_vacancy_factory, db_session
):
    urgent_open = published_vacancy_factory(campus_code="SSE", slot_count=1)
    urgent_open.vacancy_request.priority = VacancyPriorityEnum.URGENT

    urgent_closed = published_vacancy_factory(campus_code="SSE", slot_count=1)
    urgent_closed.vacancy_request.priority = VacancyPriorityEnum.URGENT
    db_session.commit()
    vacancy_workflow.close(
        db_session,
        urgent_closed.vacancy_request,
        urgent_closed.approved_vacancy,
        urgent_closed.job_posting,
        urgent_closed.hr_admin,
        None,
    )

    normal_priority = published_vacancy_factory(campus_code="SSE", slot_count=1)  # defaults to NORMAL
    db_session.commit()

    response = _kpis(client, urgent_open.hr_admin)
    assert response.status_code == 200
    assert response.json()["urgent_vacancy_count"] == 1


def test_urgent_vacancy_count_respects_campus_scope(client, published_vacancy_factory, db_session):
    sse_urgent = published_vacancy_factory(campus_code="SSE", slot_count=1)
    sse_urgent.vacancy_request.priority = VacancyPriorityEnum.URGENT
    scad_urgent = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    scad_urgent.vacancy_request.priority = VacancyPriorityEnum.URGENT
    db_session.commit()

    scoped_response = _kpis(client, sse_urgent.hod)
    assert scoped_response.json()["urgent_vacancy_count"] == 1

    global_response = _kpis(client, sse_urgent.hr_admin)
    assert global_response.json()["urgent_vacancy_count"] == 2


def _funnel_map(body) -> dict[str, int]:
    return {row["stage"]: row["count"] for row in body["application_pipeline_funnel"]}


def test_application_pipeline_funnel_buckets_and_order(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=5)
    actor = vacancy.hr_admin

    application_factory(vacancy.job_posting, recorded_by=actor)  # stays APPLIED

    screening = application_factory(vacancy.job_posting, recorded_by=actor)
    pipeline.transition_application_status(
        db_session, application=screening, new_status=ApplicationStatusEnum.SCREENING, actor=actor
    )

    called = application_factory(vacancy.job_posting, recorded_by=actor)
    for target in (ApplicationStatusEnum.SCREENING, ApplicationStatusEnum.CALLED_FOR_INTERVIEW):
        pipeline.transition_application_status(db_session, application=called, new_status=target, actor=actor)

    interviewed = application_factory(vacancy.job_posting, recorded_by=actor)
    for target in (
        ApplicationStatusEnum.SCREENING,
        ApplicationStatusEnum.CALLED_FOR_INTERVIEW,
        ApplicationStatusEnum.INTERVIEWED,
    ):
        pipeline.transition_application_status(db_session, application=interviewed, new_status=target, actor=actor)

    selected = application_factory(vacancy.job_posting, recorded_by=actor)
    for target in (
        ApplicationStatusEnum.SCREENING,
        ApplicationStatusEnum.CALLED_FOR_INTERVIEW,
        ApplicationStatusEnum.INTERVIEWED,
        ApplicationStatusEnum.SELECTED,
    ):
        pipeline.transition_application_status(db_session, application=selected, new_status=target, actor=actor)

    rejected = application_factory(vacancy.job_posting, recorded_by=actor)
    pipeline.transition_application_status(
        db_session, application=rejected, new_status=ApplicationStatusEnum.REJECTED, actor=actor, reason="Not a fit"
    )

    withdrawn = application_factory(vacancy.job_posting, recorded_by=actor)
    pipeline.transition_application_status(
        db_session,
        application=withdrawn,
        new_status=ApplicationStatusEnum.WITHDRAWN,
        actor=actor,
        reason="No longer interested",
    )
    db_session.commit()

    response = _kpis(client, actor)
    assert response.status_code == 200
    body = response.json()

    # Always all 7 buckets, in this exact order, even when a count is 0.
    assert [row["stage"] for row in body["application_pipeline_funnel"]] == [
        "Applied",
        "Screening",
        "Interview",
        "Selected",
        "Offer",
        "Joined",
        "Rejected",
    ]
    assert _funnel_map(body) == {
        "Applied": 1,
        "Screening": 1,
        "Interview": 2,  # CALLED_FOR_INTERVIEW + INTERVIEWED collapse into one bucket
        "Selected": 1,
        "Offer": 0,
        "Joined": 0,
        "Rejected": 2,  # REJECTED + WITHDRAWN collapse into one bucket
    }


def test_application_pipeline_funnel_respects_campus_scope(
    client, published_vacancy_factory, application_factory, db_session
):
    sse_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    scad_vacancy = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application_factory(sse_vacancy.job_posting, recorded_by=sse_vacancy.hr_admin)
    application_factory(scad_vacancy.job_posting, recorded_by=scad_vacancy.hr_admin)
    application_factory(scad_vacancy.job_posting, recorded_by=scad_vacancy.hr_admin)

    scoped_response = _kpis(client, sse_vacancy.hod)
    assert _funnel_map(scoped_response.json())["Applied"] == 1

    global_response = _kpis(client, sse_vacancy.hr_admin)
    assert _funnel_map(global_response.json())["Applied"] == 3


def test_critical_vacancies_teaching_row_with_no_pending_request(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )

    response = _kpis(client, hr_admin)
    assert response.status_code == 200
    rows = response.json()["critical_vacancies"]
    assert len(rows) == 1
    assert rows[0] == {
        "department": department.name,
        "designation": designation.name,
        "location": None,
        "category": "TEACHING",
        "vacancy_count": 5,
    }


def test_critical_vacancies_excludes_rows_with_a_pending_request(
    client,
    db_session,
    published_vacancy_factory,
    designation_factory,
    sanctioned_strength_factory,
):
    """A designation with an in-flight VacancyRequest is APPROVAL_PENDING,
    not VACANCY_RECRUITMENT_REQUIRED -- it must not show up as critical."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    vacancy.vacancy_request.designation_id = designation.id
    db_session.flush()
    sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=5,
        created_by=vacancy.hr_admin,
    )
    db_session.commit()

    response = _kpis(client, vacancy.hr_admin)
    rows = response.json()["critical_vacancies"]
    assert rows == []


def test_critical_vacancies_respects_campus_scope(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    sse_campus = campus_factory("SSE")
    sse_department = department_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sse_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=sse_department)
    sanctioned_strength_factory(
        campus=sse_campus, department=sse_department, designation=sse_designation, approved_strength=5,
        created_by=hr_admin,
    )

    scad_campus = campus_factory("SCAD")
    scad_department = department_factory("SCAD")
    scad_designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=scad_department)
    sanctioned_strength_factory(
        campus=scad_campus, department=scad_department, designation=scad_designation, approved_strength=9,
        created_by=hr_admin,
    )

    sse_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    scoped_response = _kpis(client, sse_hod)
    scoped_rows = scoped_response.json()["critical_vacancies"]
    assert len(scoped_rows) == 1
    assert scoped_rows[0]["vacancy_count"] == 5

    global_response = _kpis(client, hr_admin)
    global_rows = global_response.json()["critical_vacancies"]
    assert {r["vacancy_count"] for r in global_rows} == {5, 9}


def test_recent_joins_top10_ordered_by_date_desc(client, published_vacancy_factory, hired_employee_factory):
    older_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    older = hired_employee_factory(older_vacancy, joining_date=date(2026, 1, 1))
    newer_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    newer = hired_employee_factory(newer_vacancy, joining_date=date(2026, 2, 1))

    response = _kpis(client, older_vacancy.hr_admin)
    assert response.status_code == 200
    rows = response.json()["recent_joins"]
    names_in_order = [r["employee_name"] for r in rows]
    assert names_in_order.index(newer.employee.full_name) < names_in_order.index(older.employee.full_name)

    newest_row = next(r for r in rows if r["employee_name"] == newer.employee.full_name)
    assert newest_row["date"] == "2026-02-01"
    assert newest_row["campus"] == "SSE"
    assert newest_row["designation"] == newer.employee.designation
    assert newest_row["department"] == newer_vacancy.department.name


def test_recent_joins_respects_campus_scope(client, published_vacancy_factory, hired_employee_factory):
    sse_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(sse_vacancy)
    scad_vacancy = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    hired_employee_factory(scad_vacancy)

    scoped_response = _kpis(client, sse_vacancy.hod)
    scoped_campuses = {r["campus"] for r in scoped_response.json()["recent_joins"]}
    assert scoped_campuses == {"SSE"}

    global_response = _kpis(client, sse_vacancy.hr_admin)
    global_campuses = {r["campus"] for r in global_response.json()["recent_joins"]}
    assert {"SSE", "SCAD"} <= global_campuses


def test_recent_resignations_only_resigned_with_a_separation_date(
    client, published_vacancy_factory, hired_employee_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    resigned = hired_employee_factory(vacancy, joining_date=date(2025, 1, 1))
    resigned.employee.employment_status = EmploymentStatusEnum.RESIGNED
    resigned.employee.separation_date = date(2026, 3, 1)

    still_active = hired_employee_factory(vacancy, joining_date=date(2025, 6, 1))  # never resigned
    db_session.commit()

    response = _kpis(client, vacancy.hr_admin)
    assert response.status_code == 200
    rows = response.json()["recent_resignations"]
    assert len(rows) == 1
    assert rows[0]["employee_name"] == resigned.employee.full_name
    assert rows[0]["date"] == "2026-03-01"
    assert rows[0]["designation"] == resigned.employee.designation
    names = {r["employee_name"] for r in rows}
    assert still_active.employee.full_name not in names


def test_recent_resignations_respects_campus_scope(
    client, published_vacancy_factory, hired_employee_factory, db_session
):
    sse_vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    sse_hired = hired_employee_factory(sse_vacancy)
    sse_hired.employee.employment_status = EmploymentStatusEnum.RESIGNED
    sse_hired.employee.separation_date = date(2026, 1, 1)

    scad_vacancy = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    scad_hired = hired_employee_factory(scad_vacancy)
    scad_hired.employee.employment_status = EmploymentStatusEnum.RESIGNED
    scad_hired.employee.separation_date = date(2026, 1, 2)
    db_session.commit()

    scoped_response = _kpis(client, sse_vacancy.hod)
    scoped_campuses = {r["campus"] for r in scoped_response.json()["recent_resignations"]}
    assert scoped_campuses == {"SSE"}

    global_response = _kpis(client, sse_vacancy.hr_admin)
    global_campuses = {r["campus"] for r in global_response.json()["recent_resignations"]}
    assert {"SSE", "SCAD"} <= global_campuses
