"""Location bulk upload (glowing-zooming-hamming.md Phase J) --
validate/commit/template, backed by app/services/location_import.py and the
new endpoints in app/api/v1/routers/locations.py. Shared-endpoint (list/
error-report/undo) entity-agnostic behavior is covered in
tests/test_bulk_upload_shared_endpoints.py, not duplicated here.
"""

import csv
import io
import uuid

import pytest

from app.models.bulk_upload_log import BulkUploadLog
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.location import Location

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/locations"

HEADERS = ["Campus Code", "Location Name", "Block/Building", "Floor/Venue", "Category"]


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
def location_upload_setup(campus_factory, user_factory):
    campus = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    return {"campus": campus, "hr_admin": hr_admin, "recruitment_officer": recruitment_officer}


def _row(setup, name="New Block", block="Block A", floor="Ground Floor", category="TEACHING"):
    return [setup["campus"].code, name, block, floor, category]


# --- validate: read-only, DB untouched ------------------------------------


def test_validate_new_row_is_created_and_writes_nothing(client, location_upload_setup, db_session):
    response = _upload_validate(client, location_upload_setup["hr_admin"], [_row(location_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"
    assert db_session.query(Location).count() == 0
    assert db_session.query(BulkUploadLog).count() == 0


def test_validate_existing_row_identical_is_unchanged(client, location_upload_setup, location_factory):
    location_factory("SSE", name="New Block", category=StaffRoleCategoryEnum.TEACHING)
    row = _row(location_upload_setup)
    row[2] = ""  # no block/floor set on the factory row
    row[3] = ""
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["unchanged_count"] == 1
    assert body["rows"][0]["status"] == "unchanged"


def test_validate_existing_row_changed_field_is_updated(client, location_upload_setup, location_factory):
    location_factory("SSE", name="New Block", category=StaffRoleCategoryEnum.TEACHING)
    response = _upload_validate(
        client, location_upload_setup["hr_admin"], [_row(location_upload_setup, block="Block B")]
    )
    body = response.json()
    assert body["updated_count"] == 1
    assert body["rows"][0]["status"] == "updated"


def test_validate_unknown_campus_is_rejected(client, location_upload_setup):
    row = _row(location_upload_setup)
    row[0] = "ZZZ"
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "campus" in body["rows"][0]["error_reason"].lower()


def test_validate_missing_name_is_rejected(client, location_upload_setup):
    row = _row(location_upload_setup, name="")
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1


def test_validate_invalid_category_is_rejected(client, location_upload_setup):
    row = _row(location_upload_setup, category="BOGUS")
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "category" in body["rows"][0]["error_reason"].lower()


def test_validate_blank_category_is_allowed(client, location_upload_setup):
    row = _row(location_upload_setup, category="")
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["category"] is None


def test_validate_duplicate_key_in_file_is_rejected(client, location_upload_setup):
    row = _row(location_upload_setup)
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row, list(row)])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1


def test_validate_allowed_for_recruitment_officer(client, location_upload_setup):
    """The exact case that would have been broken by blindly reusing
    SANCTIONED_STRENGTH_WRITE_ROLES (SUPER_ADMIN/HR_ADMIN only) -- Location's
    own write roles include RECRUITMENT_OFFICER."""
    response = _upload_validate(client, location_upload_setup["recruitment_officer"], [_row(location_upload_setup)])
    assert response.status_code == 200


def test_validate_forbidden_for_non_write_role(client, location_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _upload_validate(client, hod, [_row(location_upload_setup)])
    assert response.status_code == 403


# --- commit: writes + BulkUploadRowLog -------------------------------------


def test_commit_creates_row_and_log(client, location_upload_setup, db_session):
    response = _upload_commit(client, location_upload_setup["hr_admin"], [_row(location_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    log_id = uuid.UUID(body["bulk_upload_log_id"])

    row = db_session.query(Location).one()
    assert row.name == "New Block"
    assert row.campus_id == location_upload_setup["campus"].id

    log = db_session.get(BulkUploadLog, log_id)
    assert log.entity_type.value == "LOCATION"
    assert log.rows_created == 1
    assert log.stored_file_object_key is not None


def test_commit_updates_existing_row(client, location_upload_setup, location_factory, db_session):
    existing = location_factory("SSE", name="New Block", category=StaffRoleCategoryEnum.TEACHING)
    db_session.commit()

    response = _upload_commit(
        client, location_upload_setup["hr_admin"], [_row(location_upload_setup, block="Block Z")]
    )
    assert response.status_code == 200
    body = response.json()
    assert body["updated_count"] == 1

    db_session.refresh(existing)
    assert existing.block_building == "Block Z"


def test_commit_skips_rejected_rows(client, location_upload_setup, db_session):
    good = _row(location_upload_setup)
    bad = _row(location_upload_setup, name="Other")
    bad[0] = "ZZZ"
    response = _upload_commit(client, location_upload_setup["hr_admin"], [good, bad])
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert db_session.query(Location).count() == 1


def test_commit_allowed_for_recruitment_officer(client, location_upload_setup):
    response = _upload_commit(client, location_upload_setup["recruitment_officer"], [_row(location_upload_setup)])
    assert response.status_code == 200


def test_commit_forbidden_for_non_write_role(client, location_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _upload_commit(client, hod, [_row(location_upload_setup)])
    assert response.status_code == 403


# --- template -----------------------------------------------------------


def test_template_download_is_xlsx(client, location_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, location_upload_setup["hr_admin"])
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_template_forbidden_for_non_write_role(client, location_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get(f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, hod))
    assert response.status_code == 403
