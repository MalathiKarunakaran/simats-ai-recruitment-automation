from datetime import date, datetime, timezone

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.services import vacancy_workflow

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
