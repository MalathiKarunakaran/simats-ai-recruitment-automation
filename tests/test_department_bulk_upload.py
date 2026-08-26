"""Department bulk upload (Department Master hardening epic, 2026-08-25) --
validate/commit/template, backed by app/services/department_import.py and
the new endpoints in app/api/v1/routers/departments.py. Shared-endpoint
(list/error-report/undo) entity-agnostic behavior for DEPARTMENT batches is
covered in tests/test_bulk_upload_shared_endpoints.py, not duplicated here.
"""

import csv
import io
import uuid

import pytest

from app.models.bulk_upload_log import BulkUploadLog
from app.models.department import Department
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/departments"

HEADERS = ["Campus Code", "Department Code", "Department Name", "Category", "Parent Group", "Description", "Active"]


def _csv_bytes(rows: list[list]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADERS)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _upload_validate(client, actor, rows):
    return client.post(
        f"{ENDPOINT}/bulk-upload/validate",
        files={"file": ("upload.csv", _csv_bytes(rows), "text/csv")},
        headers=auth_headers(client, actor),
    )


def _upload_commit(client, actor, rows, filename: str = "upload.csv"):
    return client.post(
        f"{ENDPOINT}/bulk-upload/commit",
        files={"file": (filename, _csv_bytes(rows), "text/csv")},
        headers=auth_headers(client, actor),
    )


@pytest.fixture()
def department_upload_setup(campus_factory, user_factory):
    campus = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    return {"campus": campus, "hr_admin": hr_admin, "hod": hod}


def _row(setup, code="CSE", name="Computer Science", category="TEACHING", parent_group="Engineering", description="", active="TRUE"):
    return [setup["campus"].code, code, name, category, parent_group, description, active]


# --- validate: read-only, DB untouched --------------------------------------


def test_validate_new_row_is_created_and_writes_nothing(client, department_upload_setup, db_session):
    response = _upload_validate(client, department_upload_setup["hr_admin"], [_row(department_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"
    assert db_session.query(Department).count() == 0
    assert db_session.query(BulkUploadLog).count() == 0


def test_validate_existing_row_identical_is_unchanged(client, department_upload_setup, department_factory):
    department_factory(
        "SSE", name="Computer Science", code="CSE", category=StaffRoleCategoryEnum.TEACHING,
        parent_group="Engineering",
    )
    response = _upload_validate(client, department_upload_setup["hr_admin"], [_row(department_upload_setup)])
    body = response.json()
    assert body["unchanged_count"] == 1
    assert body["rows"][0]["status"] == "unchanged"


def test_validate_existing_row_with_changed_name_is_updated_not_created(
    client, department_upload_setup, department_factory
):
    """Department Name is deliberately NOT part of the identity key (Campus
    Code + Department Code only) -- a changed name on an already-known
    (campus, code) pair is a legitimate Updated row, not a new/duplicate
    one."""
    department_factory(
        "SSE", name="Comp Sci (old name)", code="CSE", category=StaffRoleCategoryEnum.TEACHING,
        parent_group="Engineering",
    )
    response = _upload_validate(
        client, department_upload_setup["hr_admin"], [_row(department_upload_setup, name="Computer Science")]
    )
    body = response.json()
    assert body["created_count"] == 0
    assert body["updated_count"] == 1
    assert body["rows"][0]["status"] == "updated"


@pytest.mark.parametrize(
    "field,value",
    [
        ("category", "NON_TEACHING"),
        ("parent_group", "Science"),
        ("description", "New description"),
        ("active", "FALSE"),
    ],
)
def test_validate_existing_row_with_changed_field_is_updated(
    client, department_upload_setup, department_factory, field, value
):
    department_factory(
        "SSE", name="Computer Science", code="CSE", category=StaffRoleCategoryEnum.TEACHING,
        parent_group="Engineering",
    )
    kwargs = {"category": "TEACHING", "parent_group": "Engineering", "description": "", "active": "TRUE"}
    kwargs[field] = value
    response = _upload_validate(client, department_upload_setup["hr_admin"], [_row(department_upload_setup, **kwargs)])
    body = response.json()
    assert body["updated_count"] == 1, body


def test_validate_missing_campus_code_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    row[0] = ""
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Campus Code" in body["rows"][0]["error_reason"]


def test_validate_unknown_campus_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    row[0] = "ZZZ"
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "campus" in body["rows"][0]["error_reason"].lower()


def test_validate_missing_department_code_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    row[1] = ""
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Department Code" in body["rows"][0]["error_reason"]


def test_validate_missing_department_name_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    row[2] = ""
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Department Name" in body["rows"][0]["error_reason"]


def test_validate_missing_category_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    row[3] = ""
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Category" in body["rows"][0]["error_reason"]


def test_validate_invalid_category_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup, category="BOGUS")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Category" in body["rows"][0]["error_reason"]


def test_validate_parent_group_and_description_are_free_text_no_validation(client, department_upload_setup):
    row = _row(department_upload_setup, parent_group="Anything Goes", description="Some free text here.")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["parent_group"] == "Anything Goes"
    assert body["rows"][0]["description"] == "Some free text here."


def test_validate_blank_active_defaults_to_true(client, department_upload_setup):
    row = _row(department_upload_setup, active="")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["is_active"] is True


def test_validate_invalid_active_value_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup, active="MAYBE")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "MAYBE" in body["rows"][0]["error_reason"]


def test_validate_active_is_case_insensitive(client, department_upload_setup):
    row = _row(department_upload_setup, active="false")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["is_active"] is False


def test_validate_duplicate_key_in_file_is_rejected(client, department_upload_setup):
    row = _row(department_upload_setup)
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row, list(row)])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert "Duplicate department" in body["rows"][1]["error_reason"]
    assert "row 2" in body["rows"][1]["error_reason"]


def test_validate_duplicate_key_in_file_is_case_insensitive(client, department_upload_setup):
    row_a = _row(department_upload_setup, code="CSE")
    row_b = _row(department_upload_setup, code="cse", name="Different Name")
    response = _upload_validate(client, department_upload_setup["hr_admin"], [row_a, row_b])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1


def test_validate_forbidden_for_non_write_role(client, department_upload_setup):
    response = _upload_validate(client, department_upload_setup["hod"], [_row(department_upload_setup)])
    assert response.status_code == 403


# --- commit: writes + BulkUploadRowLog -------------------------------------


def test_commit_creates_row_and_log(client, department_upload_setup, db_session):
    response = _upload_commit(client, department_upload_setup["hr_admin"], [_row(department_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    log_id = uuid.UUID(body["bulk_upload_log_id"])

    row = db_session.query(Department).one()
    assert row.name == "Computer Science"
    assert row.code == "CSE"
    assert row.campus_id == department_upload_setup["campus"].id

    log = db_session.get(BulkUploadLog, log_id)
    assert log.entity_type.value == "DEPARTMENT"
    assert log.rows_created == 1
    assert log.stored_file_object_key is not None


def test_commit_succeeds_with_a_storage_warning_when_object_storage_is_unavailable(
    client, department_upload_setup, db_session, fake_minio_client
):
    fake_minio_client.fail_puts = True

    response = _upload_commit(client, department_upload_setup["hr_admin"], [_row(department_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["created_count"] == 1
    assert db_session.query(Department).count() == 1

    assert body["storage_warning"] == (
        "Workbook storage is temporarily unavailable. The file was successfully parsed, "
        "but the original workbook could not be archived."
    )

    log_id = uuid.UUID(body["bulk_upload_log_id"])
    log = db_session.get(BulkUploadLog, log_id)
    assert log.stored_file_object_key is None


def test_commit_re_stamps_all_changed_fields_on_update(client, department_upload_setup, department_factory, db_session):
    existing = department_factory(
        "SSE", name="Comp Sci (old)", code="CSE", category=StaffRoleCategoryEnum.TEACHING, parent_group="Old Group",
    )
    db_session.commit()

    row = _row(department_upload_setup, name="Computer Science", parent_group="Engineering", category="NON_TEACHING")
    response = _upload_commit(client, department_upload_setup["hr_admin"], [row])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["updated_count"] == 1
    assert db_session.query(Department).count() == 1  # re-stamped in place, not a second row

    db_session.refresh(existing)
    assert existing.name == "Computer Science"
    assert existing.parent_group == "Engineering"
    assert existing.category == StaffRoleCategoryEnum.NON_TEACHING


def test_commit_skips_rejected_rows(client, department_upload_setup, db_session):
    good = _row(department_upload_setup)
    bad = _row(department_upload_setup, code="OTHER")
    bad[0] = "ZZZ"
    response = _upload_commit(client, department_upload_setup["hr_admin"], [good, bad])
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert db_session.query(Department).count() == 1


def test_commit_forbidden_for_non_write_role(client, department_upload_setup):
    response = _upload_commit(client, department_upload_setup["hod"], [_row(department_upload_setup)])
    assert response.status_code == 403


# --- template -----------------------------------------------------------


def test_template_download_is_xlsx(client, department_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, department_upload_setup["hr_admin"])
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_template_forbidden_for_non_write_role(client, department_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, department_upload_setup["hod"])
    )
    assert response.status_code == 403
