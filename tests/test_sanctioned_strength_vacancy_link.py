"""Phase E -- enforcing the Sanctioned Strength <-> Vacancy Request link
(zany-snuggling-pie.md's "Phase E" section):

- GET /sanctioned-strength/availability (the availability strip's backing
  endpoint, app/api/v1/routers/sanctioned_strength.py).
- The submit()-time 409 block (app/services/vacancy_workflow.py::submit(),
  wired through POST /vacancy-requests/{id}/submit) and its designation_id
  is-null skip.
- The SUPER_ADMIN-only override escape hatch (403/400 gating,
  is_over_sanction/over_sanction_justification, the distinct
  VACANCY_REQUEST_SANCTION_OVERRIDDEN audit action).
- The reconciliation report (app/services/reporting.py's
  sanctioned_strength_reconciliation_report, registered in REPORT_BUILDERS
  as "sanctioned-strength-reconciliation").
- The double-counting regression guard (item 31): a full vacancy-request
  lifecycle never mutates SanctionedStrength.
"""

import uuid

from app.models.audit_log import AuditLog
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.sanctioned_strength import SanctionedStrength
from app.models.vacancy_request import VacancyRequest
from app.services import vacancy_workflow

from tests.conftest import auth_headers

VR_ENDPOINT = "/api/v1/vacancy-requests"
AVAILABILITY_ENDPOINT = "/api/v1/sanctioned-strength/availability"
REPORT_ENDPOINT = "/api/v1/reports/sanctioned-strength-reconciliation"


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


def _setup(client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory, approved_strength=2):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    sanctioned_strength_factory(
        campus=campus,
        department=department,
        designation=designation,
        approved_strength=approved_strength,
        created_by=hr_admin,
    )
    return campus, department, designation, hod, hr_admin


def _create_vr(client, hod, department, campus, designation_id, requested_count):
    response = client.post(
        VR_ENDPOINT,
        headers=auth_headers(client, hod),
        json=_create_payload(
            department.id,
            campus_id=str(campus.id),
            designation_id=str(designation_id),
            requested_count=requested_count,
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# --- submit()-time enforcement -------------------------------------------------


def test_submit_blocked_when_requested_count_exceeds_available_to_request(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, _ = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)

    response = client.post(f"{VR_ENDPOINT}/{vr_id}/submit", headers=auth_headers(client, hod))
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == (
        "Only 2 posts available to request for this designation. Raise a sanction revision first."
    )


def test_submit_succeeds_when_within_available_to_request(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, _ = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=5,
    )
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)

    response = client.post(f"{VR_ENDPOINT}/{vr_id}/submit", headers=auth_headers(client, hod))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUBMITTED"
    assert response.json()["is_over_sanction"] is False


def test_submit_skips_check_when_designation_id_is_null(
    client, campus_factory, department_factory, user_factory
):
    # Sanctioned Strength is keyed at designation granularity -- a request
    # raised with no designation_id has no ceiling to check against, so the
    # block never fires no matter how large requested_count is.
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        VR_ENDPOINT,
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(campus.id), requested_count=50),
    )
    assert create.status_code == 201, create.text
    vr_id = create.json()["id"]

    response = client.post(f"{VR_ENDPOINT}/{vr_id}/submit", headers=auth_headers(client, hod))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SUBMITTED"


def test_available_to_request_accounts_for_working_and_in_flight_requests(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    # approved=5; first request for 3 is in-flight (SUBMITTED); a second
    # request for 3 more should now be blocked (5 - 0 working - 3 already
    # requested = 2 available), even though 3 alone would have fit.
    campus, department, designation, hod, _ = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=5,
    )
    first_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    first_submit = client.post(f"{VR_ENDPOINT}/{first_id}/submit", headers=auth_headers(client, hod))
    assert first_submit.status_code == 200, first_submit.text

    second_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    second_submit = client.post(f"{VR_ENDPOINT}/{second_id}/submit", headers=auth_headers(client, hod))
    assert second_submit.status_code == 409, second_submit.text
    assert second_submit.json()["detail"] == (
        "Only 2 posts available to request for this designation. Raise a sanction revision first."
    )


# --- SUPER_ADMIN override --------------------------------------------------


def test_submit_override_by_non_super_admin_is_403(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, _ = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)

    response = client.post(
        f"{VR_ENDPOINT}/{vr_id}/submit",
        headers=auth_headers(client, hod),
        json={"override_sanction": True, "override_justification": "Urgent replacement hire"},
    )
    assert response.status_code == 403, response.text


def test_submit_override_without_justification_is_400(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)

    response = client.post(
        f"{VR_ENDPOINT}/{vr_id}/submit",
        headers=auth_headers(client, super_admin),
        json={"override_sanction": True, "override_justification": "   "},
    )
    assert response.status_code == 400, response.text


def test_submit_override_success_sets_flags_and_distinct_audit_log(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
    db_session,
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)

    response = client.post(
        f"{VR_ENDPOINT}/{vr_id}/submit",
        headers=auth_headers(client, super_admin),
        json={"override_sanction": True, "override_justification": "Emergency replacement hire, Dean approved verbally."},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "SUBMITTED"
    assert body["is_over_sanction"] is True
    assert body["over_sanction_justification"] == "Emergency replacement hire, Dean approved verbally."

    override_logs = (
        db_session.query(AuditLog)
        .filter(
            AuditLog.action == "VACANCY_REQUEST_SANCTION_OVERRIDDEN",
            AuditLog.entity_id == uuid.UUID(vr_id),
        )
        .all()
    )
    assert len(override_logs) == 1

    # The plain submit audit entry is still written too, as a distinct row.
    submit_logs = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "VACANCY_REQUEST_SUBMITTED", AuditLog.entity_id == uuid.UUID(vr_id))
        .all()
    )
    assert len(submit_logs) == 1


# --- GET /sanctioned-strength/availability ---------------------------------


def test_availability_endpoint_returns_expected_shape(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=5,
    )
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    client.post(f"{VR_ENDPOINT}/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.get(
        AVAILABILITY_ENDPOINT,
        headers=auth_headers(client, hr_admin),
        params={"campus_id": str(campus.id), "department_id": str(department.id), "designation_id": str(designation.id)},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "approved": 5,
        "working": 0,
        "vacant": 5,
        "already_requested": 3,
        "available_to_request": 2,
    }


def test_availability_endpoint_cross_campus_is_404(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=5,
    )
    other_campus_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get(
        AVAILABILITY_ENDPOINT,
        headers=auth_headers(client, other_campus_hod),
        params={"campus_id": str(campus.id), "department_id": str(department.id), "designation_id": str(designation.id)},
    )
    assert response.status_code == 404


# --- Reconciliation report --------------------------------------------------


def test_reconciliation_report_flags_over_committed_designation(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
    db_session,
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    override = client.post(
        f"{VR_ENDPOINT}/{vr_id}/submit",
        headers=auth_headers(client, super_admin),
        json={"override_sanction": True, "override_justification": "Emergency replacement hire."},
    )
    assert override.status_code == 200, override.text

    response = client.get(REPORT_ENDPOINT, headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    matching = [
        r for r in rows
        if r["department_name"] == department.name and r["designation_name"] == designation.name
    ]
    assert len(matching) == 1
    row = matching[0]
    assert row["campus_code"] == "SSE"
    assert row["approved_strength"] == 2
    assert row["working_count"] == 0
    assert row["already_requested"] == 3
    assert row["over_by"] == 1


def test_reconciliation_report_empty_when_nothing_over_committed(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=5,
    )
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    client.post(f"{VR_ENDPOINT}/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.get(REPORT_ENDPOINT, headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    matching = [
        r for r in rows
        if r["department_name"] == department.name and r["designation_name"] == designation.name
    ]
    assert matching == []


def test_reconciliation_report_export_xlsx(
    client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus, department, designation, hod, hr_admin = _setup(
        client, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory,
        approved_strength=2,
    )
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vr_id = _create_vr(client, hod, department, campus, designation.id, requested_count=3)
    client.post(
        f"{VR_ENDPOINT}/{vr_id}/submit",
        headers=auth_headers(client, super_admin),
        json={"override_sanction": True, "override_justification": "Emergency replacement hire."},
    )

    response = client.get(f"{REPORT_ENDPOINT}/export", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# --- Double-counting regression guard (item 31) -----------------------------


def test_full_lifecycle_never_mutates_sanctioned_strength(
    db_session, campus_factory, department_factory, designation_factory, user_factory, sanctioned_strength_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    sanctioned = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin,
    )
    sanctioned_id = sanctioned.id

    vacancy_request = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        role_category=designation.category,
        position_title=designation.name,
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=2,
        qualification="Test qualification",
        experience_required="Test experience",
        requested_by_id=hod.id,
    )
    db_session.add(vacancy_request)
    db_session.flush()

    vacancy_workflow.submit(db_session, vacancy_request, hod, None)
    vacancy_workflow.dean_approve(db_session, vacancy_request, dean, None)
    approved_vacancy = vacancy_workflow.hr_approve(db_session, vacancy_request, hr_admin, None)
    job_posting = vacancy_workflow.publish(db_session, vacancy_request, approved_vacancy, hr_admin, None)
    vacancy_workflow.close(db_session, vacancy_request, approved_vacancy, job_posting, hr_admin, None)
    db_session.flush()

    # Only one SanctionedStrength row for this key ever existed, and its
    # approved_strength is untouched by the entire vacancy-request lifecycle.
    rows = (
        db_session.query(SanctionedStrength)
        .filter(SanctionedStrength.department_id == department.id, SanctionedStrength.designation_id == designation.id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].id == sanctioned_id
    assert rows[0].approved_strength == 5
