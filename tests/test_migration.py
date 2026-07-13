import csv
import io

from app.models.department import Department
from app.models.enums import UserRoleEnum, VacancyRequestStatusEnum
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers


def _csv_bytes(rows: list[dict], fieldnames: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


_FIELDNAMES = [
    "campus_code",
    "department_name",
    "position_title",
    "role_category",
    "employment_type",
    "requested_count",
    "qualification",
    "experience_required",
    "priority",
    "salary_band_min",
    "salary_band_max",
    "skills",
    "jd_draft",
]


def _valid_row(**overrides) -> dict:
    row = {
        "campus_code": "SSE",
        "department_name": "Computer Science",
        "position_title": "Assistant Professor",
        "role_category": "TEACHING",
        "employment_type": "FULL_TIME",
        "requested_count": "2",
        "qualification": "PhD",
        "experience_required": "3+ years",
        "priority": "",
        "salary_band_min": "",
        "salary_band_max": "",
        "skills": "",
        "jd_draft": "",
    }
    row.update(overrides)
    return row


def _upload(client, actor, csv_bytes: bytes, filename: str = "legacy.csv"):
    return client.post(
        "/api/v1/migration/import-legacy-vacancies",
        headers=auth_headers(client, actor),
        files={"file": (filename, csv_bytes, "text/csv")},
    )


def test_import_happy_path_creates_draft_vacancy_requests(client, campus_factory, user_factory, db_session):
    campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    rows = [_valid_row(position_title="Assistant Professor"), _valid_row(position_title="Associate Professor")]
    response = _upload(client, hr_admin, _csv_bytes(rows, _FIELDNAMES))

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 2
    assert body["created_count"] == 2
    assert body["error_count"] == 0

    created = db_session.query(VacancyRequest).filter(VacancyRequest.campus_id.isnot(None)).all()
    titles = {vr.position_title for vr in created}
    assert {"Assistant Professor", "Associate Professor"} <= titles
    for vr in created:
        assert vr.status == VacancyRequestStatusEnum.DRAFT


def test_import_reports_row_level_errors_without_failing_whole_request(client, campus_factory, user_factory):
    campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    rows = [
        _valid_row(position_title="Valid Row"),
        _valid_row(position_title="Bad Role Category", role_category="NOT_A_CATEGORY"),
        _valid_row(position_title="Missing Count", requested_count=""),
    ]
    response = _upload(client, hr_admin, _csv_bytes(rows, _FIELDNAMES))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["error_count"] == 2
    error_rows = [r for r in body["rows"] if r["status"] == "error"]
    assert len(error_rows) == 2
    assert any("role_category" in e for r in error_rows for e in r["errors"])
    assert any("requested_count" in e for r in error_rows for e in r["errors"])


def test_import_creates_department_when_missing(client, campus_factory, user_factory, db_session):
    campus = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    rows = [_valid_row(department_name="Brand New Department")]
    response = _upload(client, hr_admin, _csv_bytes(rows, _FIELDNAMES))

    assert response.status_code == 200
    assert response.json()["created_count"] == 1
    dept = (
        db_session.query(Department)
        .filter(Department.campus_id == campus.id, Department.name == "Brand New Department")
        .one_or_none()
    )
    assert dept is not None


def test_import_rejects_unknown_campus_code_as_row_error(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    rows = [_valid_row(campus_code="ZZZ")]
    response = _upload(client, hr_admin, _csv_bytes(rows, _FIELDNAMES))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["error_count"] == 1
    assert "campus_code" in body["rows"][0]["errors"][0]


def test_import_rejects_non_csv_file(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/migration/import-legacy-vacancies",
        headers=auth_headers(client, hr_admin),
        files={"file": ("legacy.txt", b"not a csv", "text/plain")},
    )
    assert response.status_code == 400


def test_import_rbac_denies_recruitment_officer(client, user_factory):
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    rows = [_valid_row()]
    response = _upload(client, recruitment_officer, _csv_bytes(rows, _FIELDNAMES))
    assert response.status_code == 403
