"""Raising a replacement vacancy request from an offboarding (2026-09-07).

The draft must be a faithful one-position clone of the requisition the
leaver was hired against, owned by whoever offboarded them, linked back to
the employee, and in DRAFT -- never submitted on anyone's behalf.
"""

from datetime import date

from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum, VacancyRequestSourceEnum, VacancyRequestStatusEnum
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers


def _offboard(client, hired, actor, *, raise_replacement: bool):
    return client.post(
        f"/api/v1/employees/{hired.employee.id}/offboard",
        headers=auth_headers(client, actor),
        json={
            "separation_type": "RESIGNED",
            "separation_date": date(2026, 9, 30).isoformat(),
            "reason": "Moving abroad",
            "raise_replacement_request": raise_replacement,
        },
    )


def test_offboard_without_the_flag_raises_nothing(client, db_session, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    before = db_session.query(VacancyRequest).count()

    response = _offboard(client, hired, vacancy.hr_admin, raise_replacement=False)

    assert response.status_code == 200
    assert response.json()["replacement_vacancy_request_id"] is None
    assert db_session.query(VacancyRequest).count() == before


def test_offboard_with_the_flag_creates_a_one_position_draft_clone(
    client, db_session, published_vacancy_factory, hired_employee_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=3)
    original = vacancy.vacancy_request
    original.salary_band_min, original.salary_band_max = 60000, 90000
    original.skills = ["Python", "Teaching"]
    hired = hired_employee_factory(vacancy)

    response = _offboard(client, hired, vacancy.hr_admin, raise_replacement=True)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["employment_status"] == "RESIGNED"
    new_id = body["replacement_vacancy_request_id"]
    assert new_id is not None

    draft = db_session.get(VacancyRequest, new_id)
    assert draft.status == VacancyRequestStatusEnum.DRAFT
    assert draft.requested_count == 1  # never the original's 3
    assert draft.campus_id == hired.employee.campus_id
    assert draft.department_id == hired.employee.department_id
    assert draft.role_category == original.role_category
    assert draft.position_title == hired.employee.designation
    assert draft.employment_type == original.employment_type
    assert draft.qualification == original.qualification
    assert draft.experience_required == original.experience_required
    assert (draft.salary_band_min, draft.salary_band_max) == (60000, 90000)
    assert draft.skills == ["Python", "Teaching"]
    assert draft.source == VacancyRequestSourceEnum.MANUAL
    assert draft.requested_by_id == vacancy.hr_admin.id
    assert draft.replacement_for_employee_id == hired.employee.id
    assert draft.submitted_at is None
    assert hired.employee.full_name in draft.remarks
    assert hired.employee.employee_code in draft.remarks
    assert "resigned 2026-09-30" in draft.remarks
    assert "Moving abroad" in draft.remarks

    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "VacancyRequest", AuditLog.entity_id == draft.id, AuditLog.action == "CREATE")
        .one()
    )
    assert audit.after_state["replacement_for_employee_id"] == str(hired.employee.id)


def test_the_draft_is_readable_and_names_the_employee(client, published_vacancy_factory, hired_employee_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    new_id = _offboard(client, hired, vacancy.hr_admin, raise_replacement=True).json()["replacement_vacancy_request_id"]

    body = client.get(f"/api/v1/vacancy-requests/{new_id}", headers=auth_headers(client, vacancy.hr_admin)).json()

    assert body["status"] == "DRAFT"
    assert body["replacement_for_employee_id"] == str(hired.employee.id)
    assert body["requested_count"] == 1


def test_an_ordinary_request_has_no_replacement_link(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    body = client.get(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()
    assert body["replacement_for_employee_id"] is None


def test_a_failed_offboard_raises_no_replacement(client, db_session, published_vacancy_factory, hired_employee_factory):
    """Same transaction: a refused separation leaves no orphan draft."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    assert _offboard(client, hired, vacancy.hr_admin, raise_replacement=False).status_code == 200
    before = db_session.query(VacancyRequest).count()

    second = _offboard(client, hired, vacancy.hr_admin, raise_replacement=True)

    assert second.status_code == 409  # already separated
    assert db_session.query(VacancyRequest).count() == before


def test_recruitment_officer_cannot_raise_one_because_they_cannot_offboard(
    client, db_session, published_vacancy_factory, hired_employee_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    before = db_session.query(VacancyRequest).count()

    response = _offboard(client, hired, vacancy.recruitment_officer, raise_replacement=True)

    assert response.status_code == 403
    assert db_session.query(VacancyRequest).count() == before


def test_super_admin_owns_the_draft_they_raise(client, db_session, published_vacancy_factory, hired_employee_factory, user_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    new_id = _offboard(client, hired, super_admin, raise_replacement=True).json()["replacement_vacancy_request_id"]

    assert db_session.get(VacancyRequest, new_id).requested_by_id == super_admin.id
