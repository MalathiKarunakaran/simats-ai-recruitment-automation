import io

from openpyxl import Workbook

from app.models.approved_vacancy import ApprovedVacancy
from app.models.application import Application
from app.models.enums import ApplicationStatusEnum, HiringSlotStatusEnum, UserRoleEnum, VacancyRequestStatusEnum
from app.models.hiring_slot import HiringSlot
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers

VACANCY_HEADERS = (
    "Request ID",
    "Date Requested",
    "Campus",
    "Department",
    "Staff Category",
    "Position",
    "Vacancies Approved",
    "JD Status",
    "Priority",
    "Vacancy Status",
    "Requested By",
)

CANDIDATE_HEADERS = (
    "Candidate ID",
    "Vacancy Ref",
    "Name",
    "Contact Number",
    "Email",
    "Campus",
    "Department",
    "Staff Category",
    "Position Applied",
    "Source",
    "Reference Name",
    "Resume Received Date",
    "Called Date",
    "Interview Scheduled Date",
    "Panel Members",
    "Panel Result",
    "Panel Remarks",
    "Salary Fixed",
    "Offer Given Date",
    "Joining Confirmed (Y/N)",
    "Expected Joining Date",
    "Actual Joining Date",
    "Department Allotted",
    "Room Allotted",
    "Orientation Date",
    "HOD Assigned",
    "Status",
    "Remarks",
)


def _workbook_bytes(vacancy_rows: list[dict], candidate_rows: list[dict]) -> bytes:
    wb = Workbook()
    vacancy_ws = wb.active
    vacancy_ws.title = "Vacancy Tracker"
    vacancy_ws.append(list(VACANCY_HEADERS))
    for row in vacancy_rows:
        vacancy_ws.append([row.get(h, "") for h in VACANCY_HEADERS])

    candidate_ws = wb.create_sheet("Candidate Pipeline")
    candidate_ws.append(list(CANDIDATE_HEADERS))
    for row in candidate_rows:
        candidate_ws.append([row.get(h, "") for h in CANDIDATE_HEADERS])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _vacancy_row(**overrides) -> dict:
    row = {
        "Request ID": "REQ-TEST-001",
        "Date Requested": "2026-07-01",
        "Campus": "SSE",
        "Department": "Computer Science",
        "Staff Category": "Teaching",
        "Position": "Assistant Professor",
        "Vacancies Approved": 2,
        "Priority": "NORMAL",
        "Requested By": "Some HOD",
    }
    row.update(overrides)
    return row


def _candidate_row(**overrides) -> dict:
    row = {
        "Candidate ID": "CAND-TEST-001",
        "Vacancy Ref": "REQ-TEST-001",
        "Name": "Test Candidate",
        "Contact Number": "9999999999",
        "Email": "tracker.import.test@example.com",
        "Campus": "SSE",
        "Source": "Job Portal",
        "Status": "APPLIED",
    }
    row.update(overrides)
    return row


def _upload(client, actor, workbook_bytes: bytes, include_sample: bool = False):
    url = "/api/v1/migration/import-tracker-workbook"
    if include_sample:
        url += "?include_sample=true"
    return client.post(
        url,
        headers=auth_headers(client, actor),
        files={
            "file": (
                "tracker.xlsx",
                workbook_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


def test_import_vacancy_row_creates_published_vacancy_with_slots(client, campus_factory, department_factory, user_factory, db_session):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(client, hr_admin, _workbook_bytes([_vacancy_row()], []))

    assert response.status_code == 200
    body = response.json()
    assert body["vacancy_imported_count"] == 1
    assert body["vacancy_flagged_count"] == 0

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").one()
    assert vr.status == VacancyRequestStatusEnum.PUBLISHED
    approved_vacancy = db_session.query(ApprovedVacancy).filter(ApprovedVacancy.vacancy_request_id == vr.id).one()
    assert approved_vacancy.total_positions == 2
    slots = db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == approved_vacancy.id).all()
    assert len(slots) == 2
    assert all(s.status == HiringSlotStatusEnum.OPEN for s in slots)
    assert approved_vacancy.job_posting is not None
    assert approved_vacancy.job_posting.is_active is True


def test_import_candidate_row_requires_vacancy_already_imported(client, campus_factory, user_factory):
    campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(client, hr_admin, _workbook_bytes([], [_candidate_row()]))

    assert response.status_code == 200
    body = response.json()
    assert body["candidate_imported_count"] == 0
    assert body["candidate_flagged_count"] == 1
    assert "Unknown Vacancy Ref" in body["candidate_rows"][0]["errors"][0]


def test_import_candidate_row_happy_path_creates_application(client, campus_factory, department_factory, user_factory, db_session):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(
        client,
        hr_admin,
        _workbook_bytes([_vacancy_row()], [_candidate_row(**{"Panel Result": "Selected", "Salary Fixed": 80000})]),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["candidate_imported_count"] == 1

    application = db_session.query(Application).filter(Application.external_ref == "CAND-TEST-001").one()
    assert application.status == ApplicationStatusEnum.APPLIED
    assert application.candidate.email == "tracker.import.test@example.com"
    assert application.candidate.source == "Job Portal"


def test_import_reference_source_requires_reference_name(client, campus_factory, department_factory, user_factory):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(
        client,
        hr_admin,
        _workbook_bytes([_vacancy_row()], [_candidate_row(Source="Reference", **{"Reference Name": ""})]),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["candidate_flagged_count"] == 1
    assert any("Reference Name" in e for e in body["candidate_rows"][0]["errors"])


def test_import_joined_status_fills_slot_and_autocloses_vacancy(client, campus_factory, department_factory, user_factory, db_session):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(
        client,
        hr_admin,
        _workbook_bytes(
            [_vacancy_row(**{"Vacancies Approved": 1})],
            [_candidate_row(Status="JOINED")],
        ),
    )

    assert response.status_code == 200
    assert response.json()["candidate_imported_count"] == 1

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").one()
    assert vr.status == VacancyRequestStatusEnum.CLOSED
    application = db_session.query(Application).filter(Application.external_ref == "CAND-TEST-001").one()
    slot = db_session.query(HiringSlot).filter(HiringSlot.reserved_application_id == application.id).one()
    assert slot.status == HiringSlotStatusEnum.FILLED


def test_reimport_upserts_without_duplicating(client, campus_factory, department_factory, user_factory, db_session):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    _upload(client, hr_admin, _workbook_bytes([_vacancy_row()], [_candidate_row()]))
    response = _upload(
        client, hr_admin, _workbook_bytes([_vacancy_row(Position="Updated Title")], [_candidate_row(Status="SCREENING")])
    )

    assert response.status_code == 200
    vacancy_count = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").count()
    application_count = db_session.query(Application).filter(Application.external_ref == "CAND-TEST-001").count()
    assert vacancy_count == 1
    assert application_count == 1

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").one()
    assert vr.position_title == "Updated Title"
    application = db_session.query(Application).filter(Application.external_ref == "CAND-TEST-001").one()
    assert application.status == ApplicationStatusEnum.SCREENING


def test_import_flags_unresolved_designation_but_still_imports(
    client, campus_factory, department_factory, user_factory, db_session
):
    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(client, hr_admin, _workbook_bytes([_vacancy_row()], []))

    assert response.status_code == 200
    body = response.json()
    assert body["vacancy_imported_count"] == 1
    assert body["vacancy_flagged_count"] == 0
    row = body["vacancy_rows"][0]
    assert row["status"] == "imported_with_warning"
    assert any("Designation" in e and "not found" in e for e in row["errors"])

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").one()
    assert vr.designation_id is None
    assert vr.position_title == "Assistant Professor"


def test_import_resolves_designation_when_it_matches_master_data(
    client, campus_factory, department_factory, user_factory, db_session
):
    from app.models.designation import Designation
    from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum

    campus_factory("SSE")
    department_factory("SSE", "Computer Science")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    designation = Designation(
        name="Assistant Professor",
        category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD",
        min_experience="3+ years",
        employment_type=EmploymentTypeEnum.FULL_TIME,
    )
    db_session.add(designation)
    db_session.flush()

    response = _upload(client, hr_admin, _workbook_bytes([_vacancy_row()], []))

    assert response.status_code == 200
    body = response.json()
    row = body["vacancy_rows"][0]
    assert row["status"] == "imported"
    assert row["errors"] == []

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-TEST-001").one()
    assert vr.designation_id == designation.id


def test_import_flags_unknown_campus_without_failing_whole_request(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(client, hr_admin, _workbook_bytes([_vacancy_row(Campus="ZZZ")], []))

    assert response.status_code == 200
    body = response.json()
    assert body["vacancy_imported_count"] == 0
    assert body["vacancy_flagged_count"] == 1
    assert "Unknown Campus" in body["vacancy_rows"][0]["errors"][0]


def test_import_rejects_non_xlsx_file(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/migration/import-tracker-workbook",
        headers=auth_headers(client, hr_admin),
        files={"file": ("tracker.csv", b"not an xlsx", "text/csv")},
    )
    assert response.status_code == 400


def test_import_rbac_denies_recruitment_officer(client, user_factory):
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    response = _upload(client, recruitment_officer, _workbook_bytes([_vacancy_row()], []))
    assert response.status_code == 403


def test_import_skips_placeholder_sample_row_by_default(client, campus_factory, user_factory, db_session):
    campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _upload(client, hr_admin, _workbook_bytes([_vacancy_row(**{"Request ID": "REQ-2026-001"})], []))

    assert response.status_code == 200
    body = response.json()
    assert body["vacancy_total_rows"] == 0
    assert db_session.query(VacancyRequest).filter(VacancyRequest.external_ref == "REQ-2026-001").count() == 0


def test_download_tracker_template_happy_path(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/migration/tracker-template", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    assert response.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert len(response.content) > 0


def test_download_tracker_template_rbac_denies_recruitment_officer(client, user_factory):
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    response = client.get(
        "/api/v1/migration/tracker-template", headers=auth_headers(client, recruitment_officer)
    )
    assert response.status_code == 403
