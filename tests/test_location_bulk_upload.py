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


def test_validate_row_with_different_block_from_existing_is_created_not_updated(
    client, location_upload_setup, location_factory
):
    """Block/Building (and Floor/Venue, and Category) are now PART of the
    match key, not a mutable attribute of a single "campus + name" location
    -- so a row whose block/floor differs from an existing same-named
    location is a genuinely different real-world location and must be
    CREATED, not silently overwrite the existing row's block/floor. This is
    the exact bug this fix closes (previously: "updated", incorrectly)."""
    location_factory("SSE", name="New Block", category=StaffRoleCategoryEnum.TEACHING)
    response = _upload_validate(
        client, location_upload_setup["hr_admin"], [_row(location_upload_setup, block="Block B")]
    )
    body = response.json()
    assert body["created_count"] == 1
    assert body["updated_count"] == 0
    assert body["rows"][0]["status"] == "created"


def test_validate_matches_existing_row_only_via_normalized_text_difference_as_updated(
    client, location_upload_setup, location_factory
):
    """"Updated" now only fires when the composite key already matches (same
    real-world location) but the raw stored text differs purely in case/
    whitespace from what was just uploaded -- a legitimate cosmetic
    re-stamp, not a different location."""
    location_factory(
        "SSE", name="rb  block", category=StaffRoleCategoryEnum.TEACHING,
        block_building="ground  floor", floor_venue="wing a",
    )
    row = _row(location_upload_setup, name="RB Block", block="Ground Floor", floor="Wing A")
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["updated_count"] == 1
    assert body["rows"][0]["status"] == "updated"


def test_validate_different_floors_in_the_same_building_are_all_created(client, location_upload_setup):
    """The exact bug report scenario: a building's separate floors are
    valid, distinct locations and must NOT be rejected as duplicates of
    each other just because Campus+Location Name match."""
    rows = [
        [location_upload_setup["campus"].code, "Rectangular Building", "RB Block", "Ground Floor", "TEACHING"],
        [location_upload_setup["campus"].code, "Rectangular Building", "RB Block", "First Floor", "TEACHING"],
        [location_upload_setup["campus"].code, "Rectangular Building", "RB Block", "Second Floor", "TEACHING"],
    ]
    response = _upload_validate(client, location_upload_setup["hr_admin"], rows)
    body = response.json()
    assert body["created_count"] == 3
    assert body["rejected_count"] == 0
    assert [r["status"] for r in body["rows"]] == ["created", "created", "created"]


def test_validate_existing_location_on_a_different_floor_does_not_block_a_new_floor(
    client, location_upload_setup, location_factory
):
    """A pre-existing DB row for one floor of a building must not be
    matched against (and so must not block/overwrite) an uploaded row for a
    DIFFERENT floor of the same building."""
    location_factory(
        "SSE", name="Rectangular Building", category=StaffRoleCategoryEnum.TEACHING,
        block_building="RB Block", floor_venue="Ground Floor",
    )
    row = _row(location_upload_setup, name="Rectangular Building", block="RB Block", floor="First Floor")
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"


def test_validate_duplicate_with_only_whitespace_and_case_differences_is_rejected(client, location_upload_setup):
    """"Normalize repeated spaces"/"case-insensitive comparison" both apply
    to the duplicate check itself, not just exact-text matches."""
    row_a = [location_upload_setup["campus"].code, "Rectangular Building", "RB Block", "Ground Floor", "TEACHING"]
    row_b = [location_upload_setup["campus"].code, "rectangular   building", "rb block", "ground floor", "teaching"]
    response = _upload_validate(client, location_upload_setup["hr_admin"], [row_a, row_b])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert "Duplicate location: same Campus, Location, Block, Floor/Venue and Category" in body["rows"][1]["error_reason"]


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
    assert "Duplicate location: same Campus, Location, Block, Floor/Venue and Category" in body["rows"][1]["error_reason"]


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


def test_commit_re_stamps_canonical_text_on_a_pure_normalization_difference(
    client, location_upload_setup, location_factory, db_session
):
    """A genuine "updated": the composite key already matches (same
    real-world location), only the raw casing/whitespace differs -- commit
    re-stamps the existing row's text to the newly uploaded canonical
    form."""
    existing = location_factory(
        "SSE", name="rb  block", category=StaffRoleCategoryEnum.TEACHING,
        block_building="ground floor", floor_venue="wing a",
    )
    db_session.commit()

    row = _row(location_upload_setup, name="RB Block", block="Ground Floor", floor="Wing A")
    response = _upload_commit(client, location_upload_setup["hr_admin"], [row])
    assert response.status_code == 200
    body = response.json()
    assert body["updated_count"] == 1
    assert db_session.query(Location).count() == 1  # re-stamped in place, not a second row

    db_session.refresh(existing)
    assert existing.name == "RB Block"
    assert existing.block_building == "Ground Floor"
    assert existing.floor_venue == "Wing A"


def test_commit_creates_a_new_row_for_a_different_floor_rather_than_overwriting_the_existing_one(
    client, location_upload_setup, location_factory, db_session
):
    """The core bug fix at the commit level: uploading a genuinely different
    floor of an already-known building must create a NEW row and leave the
    existing floor's row completely untouched -- not silently overwrite it."""
    existing = location_factory(
        "SSE", name="Rectangular Building", category=StaffRoleCategoryEnum.TEACHING,
        block_building="RB Block", floor_venue="Ground Floor",
    )
    db_session.commit()

    row = _row(location_upload_setup, name="Rectangular Building", block="RB Block", floor="First Floor")
    response = _upload_commit(client, location_upload_setup["hr_admin"], [row])
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["updated_count"] == 0
    assert db_session.query(Location).count() == 2

    db_session.refresh(existing)
    assert existing.floor_venue == "Ground Floor"  # untouched by the new row's commit

    new_row = db_session.query(Location).filter(Location.id != existing.id).one()
    assert new_row.floor_venue == "First Floor"


def test_commit_creates_all_floors_of_the_same_building_as_separate_rows(
    client, location_upload_setup, db_session
):
    """End-to-end confirmation of the exact bug-report scenario: 3 distinct
    floors of one building, all valid, all created, none rejected as
    duplicates of each other."""
    campus_code = location_upload_setup["campus"].code
    rows = [
        [campus_code, "Rectangular Building", "RB Block", "Ground Floor", "TEACHING"],
        [campus_code, "Rectangular Building", "RB Block", "First Floor", "TEACHING"],
        [campus_code, "Rectangular Building", "RB Block", "Second Floor", "TEACHING"],
    ]
    response = _upload_commit(client, location_upload_setup["hr_admin"], rows)
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 3
    assert body["rejected_count"] == 0

    saved = db_session.query(Location).order_by(Location.floor_venue).all()
    assert len(saved) == 3
    assert {loc.floor_venue for loc in saved} == {"Ground Floor", "First Floor", "Second Floor"}
    assert all(loc.name == "Rectangular Building" and loc.block_building == "RB Block" for loc in saved)


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
