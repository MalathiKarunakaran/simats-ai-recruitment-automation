import io
from datetime import date, datetime, timedelta, timezone

import openpyxl
from pptx import Presentation

from app.models.enums import InterviewTypeEnum, UserRoleEnum
from app.services import interviews as interviews_service

from tests.conftest import auth_headers


def _report(client, actor, report_type, **params):
    return client.get(f"/api/v1/reports/{report_type}", headers=auth_headers(client, actor), params=params)


def _export(client, actor, report_type, **params):
    return client.get(f"/api/v1/reports/{report_type}/export", headers=auth_headers(client, actor), params=params)


def test_recruitment_funnel_report_counts(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _report(client, vacancy.hr_admin, "recruitment-funnel")
    assert response.status_code == 200
    rows = response.json()["rows"]
    row = next(r for r in rows if r["campus_code"] == "SSE" and r["status"] == "APPLIED")
    assert row["count"] == 2


def test_campus_role_hiring_report(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(vacancy)

    response = _report(client, vacancy.hr_admin, "campus-role-hiring")
    rows = response.json()["rows"]
    row = next(r for r in rows if r["campus_code"] == "SSE")
    assert row["role_category"] == "TEACHING"
    assert row["hired_count"] == 1


def test_offer_and_joining_reports(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(vacancy)

    offers_resp = _report(client, vacancy.hr_admin, "offers")
    assert offers_resp.status_code == 200
    offer_row = next(r for r in offers_resp.json()["rows"] if r["campus_code"] == "SSE")
    assert offer_row["status"] == "ACCEPTED"
    assert offer_row["count"] == 1

    joining_resp = _report(client, vacancy.hr_admin, "joining")
    assert joining_resp.status_code == 200
    joining_row = next(r for r in joining_resp.json()["rows"] if r["campus_code"] == "SSE")
    assert joining_row["onboarding_status"] == "COMPLETE"
    assert joining_row["count"] == 1


def test_interview_report_counts(client, published_vacancy_factory, application_factory, user_factory, db_session):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    panel_member = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")

    interviews_service.schedule_interview(
        db_session,
        application=application,
        interview_type=InterviewTypeEnum.TECHNICAL,
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=45,
        meeting_link="https://meet.example.com/test",
        location=None,
        notes=None,
        panel_member_ids=[panel_member.id],
        actor=vacancy.hr_admin,
    )

    response = _report(client, vacancy.hr_admin, "interviews")
    assert response.status_code == 200
    row = next(r for r in response.json()["rows"] if r["campus_code"] == "SSE")
    assert row["status"] == "SCHEDULED"
    assert row["interview_type"] == "TECHNICAL"
    assert row["count"] == 1


def test_vacancy_report_counts(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _report(client, vacancy.hr_admin, "vacancies")
    rows = response.json()["rows"]
    row = next(r for r in rows if r["campus_code"] == "SSE" and r["status"] == "PUBLISHED")
    assert row["count"] == 1


def test_time_to_hire_report_exact_average(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired_employee_factory(
        vacancy, applied_at=datetime(2026, 1, 1, tzinfo=timezone.utc), joining_date=date(2026, 1, 11)
    )

    response = _report(client, vacancy.hr_admin, "time-to-hire")
    rows = response.json()["rows"]
    row = next(r for r in rows if r["campus_code"] == "SSE")
    assert row["avg_days"] == 10.0
    assert row["hired_count"] == 1


def test_report_respects_campus_scoping(client, published_vacancy_factory, application_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application_factory(vacancy_sse.job_posting, recorded_by=vacancy_sse.hr_admin)
    application_factory(vacancy_scad.job_posting, recorded_by=vacancy_scad.hr_admin)

    hod_response = _report(client, vacancy_sse.hod, "recruitment-funnel")
    hod_codes = {row["campus_code"] for row in hod_response.json()["rows"]}
    assert hod_codes == {"SSE"}

    global_response = _report(client, vacancy_sse.hr_admin, "recruitment-funnel")
    global_codes = {row["campus_code"] for row in global_response.json()["rows"]}
    assert {"SSE", "SCAD"} <= global_codes


def test_unknown_report_type_returns_404(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _report(client, vacancy.hr_admin, "not-a-real-report")
    assert response.status_code == 404


def test_candidate_role_forbidden(client, user_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    response = _report(client, candidate_user, "vacancies")
    assert response.status_code == 403


def test_export_xlsx_is_valid_and_matches_headers(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _export(client, vacancy.hr_admin, "vacancies")
    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    workbook = openpyxl.load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    header_row = [cell.value for cell in sheet[4]]
    assert header_row == ["campus_code", "role_category", "status", "count"]


def test_ad_briefing_json_and_export(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    hired_employee_factory(vacancy)

    json_response = client.get(
        "/api/v1/reports/ad-briefing", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert json_response.status_code == 200
    body = json_response.json()
    assert "kpi_headline" in body
    breakdown_row = next(r for r in body["campus_role_breakdown"] if r["campus_code"] == "SSE")
    assert breakdown_row["hired"] == 1

    export_response = client.get(
        "/api/v1/reports/ad-briefing/export", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )

    presentation = Presentation(io.BytesIO(export_response.content))
    assert len(presentation.slides) == 1
    all_text = " ".join(
        shape.text_frame.text
        for shape in presentation.slides[0].shapes
        if shape.has_text_frame
    )
    assert "AD Briefing" in all_text
