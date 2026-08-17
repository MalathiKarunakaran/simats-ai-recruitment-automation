"""HousekeepingStaff bulk upload (glowing-zooming-hamming.md Phase J) --
validate/commit/template, backed by app/services/housekeeping_staff_import.py
and the new endpoints in app/api/v1/routers/housekeeping_staff.py.
Shared-endpoint (list/error-report/undo) entity-agnostic behavior is covered
in tests/test_bulk_upload_shared_endpoints.py, not duplicated here.
"""

import csv
import io
import uuid

import pytest

from app.models.bulk_upload_log import BulkUploadLog
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.housekeeping_staff import HousekeepingStaff

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/housekeeping-staff"

HEADERS = [
    "Campus Code",
    "Bio ID",
    "Name",
    "Designation Name",
    "Location Name",
    "Block",
    "Floor/Venue",
    "Shift",
    "Supervisor",
]


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
def housekeeping_upload_setup(campus_factory, designation_factory, location_factory, user_factory):
    campus = campus_factory("SSE")
    designation = designation_factory(
        StaffRoleCategoryEnum.HOUSEKEEPING, name=f"HK Designation {uuid.uuid4().hex[:6]}"
    )
    location = location_factory("SSE", name=f"HK Location {uuid.uuid4().hex[:6]}")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    return {
        "campus": campus,
        "designation": designation,
        "location": location,
        "hr_admin": hr_admin,
        "recruitment_officer": recruitment_officer,
    }


def _row(setup, bio_id="BIO-1001", name="Jane Doe", shift="MORNING", block="", floor="", supervisor=""):
    return [
        setup["campus"].code,
        bio_id,
        name,
        setup["designation"].name,
        setup["location"].name,
        block,
        floor,
        shift,
        supervisor,
    ]


# --- validate --------------------------------------------------------------


def test_validate_new_row_is_created_and_writes_nothing(client, housekeeping_upload_setup, db_session):
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [_row(housekeeping_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"
    assert db_session.query(HousekeepingStaff).count() == 0
    assert db_session.query(BulkUploadLog).count() == 0


def test_validate_existing_row_identical_is_unchanged(
    client, housekeeping_upload_setup, housekeeping_staff_factory
):
    housekeeping_staff_factory(
        campus=housekeeping_upload_setup["campus"],
        designation=housekeeping_upload_setup["designation"],
        location=housekeeping_upload_setup["location"],
        created_by=housekeeping_upload_setup["hr_admin"],
        bio_id="BIO-1001",
        name="Jane Doe",
    )
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [_row(housekeeping_upload_setup)])
    body = response.json()
    assert body["unchanged_count"] == 1


def test_validate_existing_row_changed_field_is_updated(
    client, housekeeping_upload_setup, housekeeping_staff_factory
):
    housekeeping_staff_factory(
        campus=housekeeping_upload_setup["campus"],
        designation=housekeeping_upload_setup["designation"],
        location=housekeeping_upload_setup["location"],
        created_by=housekeeping_upload_setup["hr_admin"],
        bio_id="BIO-1001",
        name="Jane Doe",
    )
    response = _upload_validate(
        client, housekeeping_upload_setup["hr_admin"], [_row(housekeeping_upload_setup, shift="NIGHT")]
    )
    body = response.json()
    assert body["updated_count"] == 1


def test_validate_unknown_designation_is_rejected(client, housekeeping_upload_setup):
    row = _row(housekeeping_upload_setup)
    row[3] = "Nonexistent Designation XYZ"
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "designation" in body["rows"][0]["error_reason"].lower()


def test_validate_non_housekeeping_designation_is_rejected(
    client, housekeeping_upload_setup, designation_factory
):
    teaching_designation = designation_factory(StaffRoleCategoryEnum.TEACHING)
    row = _row(housekeeping_upload_setup)
    row[3] = teaching_designation.name
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "housekeeping" in body["rows"][0]["error_reason"].lower()


def test_validate_unknown_location_is_rejected(client, housekeeping_upload_setup):
    row = _row(housekeeping_upload_setup)
    row[4] = "Nonexistent Location XYZ"
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "location" in body["rows"][0]["error_reason"].lower()


def test_validate_invalid_shift_is_rejected(client, housekeeping_upload_setup):
    row = _row(housekeeping_upload_setup, shift="LUNCHTIME")
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1


def test_validate_duplicate_key_in_file_is_rejected(client, housekeeping_upload_setup):
    row = _row(housekeeping_upload_setup)
    response = _upload_validate(client, housekeeping_upload_setup["hr_admin"], [row, list(row)])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1


def test_validate_allowed_for_recruitment_officer(client, housekeeping_upload_setup):
    response = _upload_validate(
        client, housekeeping_upload_setup["recruitment_officer"], [_row(housekeeping_upload_setup)]
    )
    assert response.status_code == 200


def test_validate_forbidden_for_non_write_role(client, housekeeping_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _upload_validate(client, hod, [_row(housekeeping_upload_setup)])
    assert response.status_code == 403


# --- commit ------------------------------------------------------------


def test_commit_creates_row_and_log(client, housekeeping_upload_setup, db_session):
    response = _upload_commit(client, housekeeping_upload_setup["hr_admin"], [_row(housekeeping_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    log_id = uuid.UUID(body["bulk_upload_log_id"])

    row = db_session.query(HousekeepingStaff).one()
    assert row.bio_id == "BIO-1001"
    assert row.created_by_id == housekeeping_upload_setup["hr_admin"].id

    log = db_session.get(BulkUploadLog, log_id)
    assert log.entity_type.value == "HOUSEKEEPING_STAFF"
    assert log.rows_created == 1


def test_commit_updates_existing_row(client, housekeeping_upload_setup, housekeeping_staff_factory, db_session):
    existing = housekeeping_staff_factory(
        campus=housekeeping_upload_setup["campus"],
        designation=housekeeping_upload_setup["designation"],
        location=housekeeping_upload_setup["location"],
        created_by=housekeeping_upload_setup["hr_admin"],
        bio_id="BIO-1001",
        name="Jane Doe",
    )
    db_session.commit()

    response = _upload_commit(
        client, housekeeping_upload_setup["hr_admin"], [_row(housekeeping_upload_setup, shift="EVENING")]
    )
    assert response.status_code == 200
    body = response.json()
    assert body["updated_count"] == 1

    db_session.refresh(existing)
    assert existing.shift.value == "EVENING"
    assert existing.updated_by_id == housekeeping_upload_setup["hr_admin"].id


def test_commit_bio_id_unique_per_campus_not_globally(
    client, housekeeping_upload_setup, campus_factory, designation_factory, location_factory, db_session
):
    """Same bio_id on a different campus is a distinct row -- not a
    conflict -- matching HousekeepingStaff's own per-campus UniqueConstraint."""
    other_campus = campus_factory("SCLAS")
    other_designation = designation_factory(
        StaffRoleCategoryEnum.HOUSEKEEPING, name=f"Other HK Designation {uuid.uuid4().hex[:6]}"
    )
    other_location = location_factory("SCLAS", name=f"Other HK Location {uuid.uuid4().hex[:6]}")

    row1 = _row(housekeeping_upload_setup)
    row2 = [
        other_campus.code,
        "BIO-1001",
        "John Doe",
        other_designation.name,
        other_location.name,
        "",
        "",
        "MORNING",
        "",
    ]
    response = _upload_commit(client, housekeeping_upload_setup["hr_admin"], [row1, row2])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 2
    assert db_session.query(HousekeepingStaff).count() == 2


def test_commit_allowed_for_recruitment_officer(client, housekeeping_upload_setup):
    response = _upload_commit(
        client, housekeeping_upload_setup["recruitment_officer"], [_row(housekeeping_upload_setup)]
    )
    assert response.status_code == 200


def test_commit_forbidden_for_non_write_role(client, housekeeping_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = _upload_commit(client, hod, [_row(housekeeping_upload_setup)])
    assert response.status_code == 403


# --- template ---------------------------------------------------------


def test_template_download_is_xlsx(client, housekeeping_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, housekeeping_upload_setup["hr_admin"])
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_template_forbidden_for_non_write_role(client, housekeeping_upload_setup, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get(f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, hod))
    assert response.status_code == 403
