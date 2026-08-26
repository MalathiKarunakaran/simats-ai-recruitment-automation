"""EligibilityRule bulk upload (starter regulatory-eligibility-rules feature,
backend Phase 1) -- validate/commit/template, backed by
app/services/eligibility_rule_import.py and the new endpoints in
app/api/v1/routers/eligibility_rules.py. Shared-endpoint
(list/error-report/undo) entity-agnostic behavior for ELIGIBILITY_RULE
batches is covered in tests/test_bulk_upload_shared_endpoints.py's own
existing DEPARTMENT/LOCATION coverage pattern, not duplicated row-by-row
here -- this file focuses on the entity-specific validate/commit/template
behavior only.
"""

import csv
import io
import uuid

import pytest

from app.models.bulk_upload_log import BulkUploadLog
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/eligibility-rules"

HEADERS = [
    "Campus Code", "Department Code", "Staff Category", "Position Title",
    "Required Qualification Keyword", "NET/SET/SLET Required", "Subject", "Skills Keyword",
    "ID Proof Required", "Shift Preference", "Regulatory Authority", "School/College",
    "Programme/Discipline", "Minimum Qualification", "Minimum Percentage", "Required Experience",
    "Required Credential", "Required Keywords (informational only)", "Preferred Keywords (informational only)",
    "PhD Required", "Professional Registration", "Industry Experience", "Priority",
    "Effective From (YYYY-MM-DD)", "Effective To (YYYY-MM-DD)", "Source Regulation", "Status",
    "Verification Required", "Active", "Notes",
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
def eligibility_upload_setup(campus_factory, user_factory, department_factory):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name="Computer Science", code="CSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    return {"campus": campus, "department": department, "hr_admin": hr_admin, "hod": hod}


def _row(
    setup,
    department_code="CSE",
    staff_category="TEACHING",
    position_title="Assistant Professor",
    required_qualification_keyword="PHD",
    net_set_required="TRUE",
    subject="Physics",
    skills_keyword="",
    id_proof_required="",
    shift_preference="",
    regulatory_authority="AICTE_UGC",
    school_or_college="",
    programme_discipline="",
    minimum_qualification="",
    minimum_percentage="",
    required_experience="",
    required_credential="",
    required_keywords="",
    preferred_keywords="",
    phd_required="TRUE",
    professional_registration="",
    industry_experience="",
    priority="",
    effective_from="2026-01-01",
    effective_to="",
    source_regulation="",
    rule_status="DRAFT",
    verification_required="TRUE",
    active="TRUE",
    notes="",
):
    return [
        setup["campus"].code, department_code, staff_category, position_title,
        required_qualification_keyword, net_set_required, subject, skills_keyword,
        id_proof_required, shift_preference, regulatory_authority, school_or_college,
        programme_discipline, minimum_qualification, minimum_percentage, required_experience,
        required_credential, required_keywords, preferred_keywords, phd_required,
        professional_registration, industry_experience, priority, effective_from, effective_to,
        source_regulation, rule_status, verification_required, active, notes,
    ]


# --- validate: read-only, DB untouched --------------------------------------


def test_validate_new_row_is_created_and_writes_nothing(client, eligibility_upload_setup, db_session):
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [_row(eligibility_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"
    assert db_session.query(EligibilityRule).count() == 0
    assert db_session.query(BulkUploadLog).count() == 0


def test_validate_missing_campus_code_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup)
    row[0] = ""
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Campus Code" in body["rows"][0]["error_reason"]


def test_validate_unknown_campus_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup)
    row[0] = "ZZZ"
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "campus" in body["rows"][0]["error_reason"].lower()


def test_validate_unknown_department_code_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, department_code="NOPE")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Department code" in body["rows"][0]["error_reason"]


def test_validate_blank_department_code_is_allowed(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, department_code="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["department_code"] is None


def test_validate_missing_staff_category_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup)
    row[2] = ""
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Staff Category" in body["rows"][0]["error_reason"]


def test_validate_invalid_staff_category_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, staff_category="BOGUS")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Staff Category" in body["rows"][0]["error_reason"]


def test_validate_missing_required_qualification_keyword_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, required_qualification_keyword="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Required Qualification Keyword" in body["rows"][0]["error_reason"]


def test_validate_invalid_regulatory_authority_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, regulatory_authority="BOGUS")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Regulatory Authority" in body["rows"][0]["error_reason"]


def test_validate_blank_regulatory_authority_is_allowed(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, regulatory_authority="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["regulatory_authority"] is None


def test_validate_invalid_effective_from_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, effective_from="not-a-date")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Effective From" in body["rows"][0]["error_reason"]


def test_validate_blank_active_and_verification_required_default_to_true(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, active="", verification_required="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["is_active"] is True
    assert body["rows"][0]["verification_required"] is True


def test_validate_blank_status_defaults_to_draft(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, rule_status="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["rule_status"] == "DRAFT"


def test_validate_blank_tristate_flags_stay_null_not_false(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup, net_set_required="", phd_required="", id_proof_required="")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["net_set_required"] is None
    assert body["rows"][0]["phd_required"] is None
    assert body["rows"][0]["id_proof_required"] is None


def test_validate_existing_row_identical_is_unchanged(client, eligibility_upload_setup, db_session):
    create_response = client.post(
        ENDPOINT,
        headers=auth_headers(client, eligibility_upload_setup["hr_admin"]),
        json={
            "campus_id": str(eligibility_upload_setup["campus"].id),
            "department_id": str(eligibility_upload_setup["department"].id),
            "staff_category": "TEACHING",
            "position_title": "Assistant Professor",
            "required_qualification_keyword": "PHD",
            "net_set_required": True,
            "subject": "Physics",
            "regulatory_authority": "AICTE_UGC",
            "phd_required": True,
            "effective_from": "2026-01-01",
            "status": "DRAFT",
            "verification_required": True,
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text

    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [_row(eligibility_upload_setup)])
    body = response.json()
    assert body["unchanged_count"] == 1, body
    assert body["rows"][0]["status"] == "unchanged"


def test_validate_existing_row_with_changed_field_is_updated(client, eligibility_upload_setup):
    create_response = client.post(
        ENDPOINT,
        headers=auth_headers(client, eligibility_upload_setup["hr_admin"]),
        json={
            "campus_id": str(eligibility_upload_setup["campus"].id),
            "department_id": str(eligibility_upload_setup["department"].id),
            "staff_category": "TEACHING",
            "position_title": "Assistant Professor",
            "required_qualification_keyword": "PHD",
            "net_set_required": True,
            "subject": "Physics",
            "regulatory_authority": "AICTE_UGC",
            "phd_required": True,
            "effective_from": "2026-01-01",
        },
    )
    assert create_response.status_code == 201, create_response.text

    response = _upload_validate(
        client, eligibility_upload_setup["hr_admin"], [_row(eligibility_upload_setup, subject="Chemistry")]
    )
    body = response.json()
    assert body["updated_count"] == 1, body
    assert body["rows"][0]["status"] == "updated"


def test_validate_duplicate_key_in_file_is_rejected(client, eligibility_upload_setup):
    row = _row(eligibility_upload_setup)
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row, list(row)])
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert "Duplicate eligibility rule" in body["rows"][1]["error_reason"]
    assert "row 2" in body["rows"][1]["error_reason"]


def test_validate_same_key_but_different_effective_from_is_allowed(client, eligibility_upload_setup):
    """Positive case: two rows sharing every key field except effective_from
    are two genuinely different rules, not a duplicate -- same 5-field
    natural key the manual create/update endpoints enforce."""
    row_a = _row(eligibility_upload_setup, effective_from="2026-01-01")
    row_b = _row(eligibility_upload_setup, effective_from="2027-01-01")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row_a, row_b])
    body = response.json()
    assert body["created_count"] == 2
    assert body["rejected_count"] == 0


def test_validate_same_key_but_different_regulatory_authority_is_allowed(client, eligibility_upload_setup):
    row_a = _row(eligibility_upload_setup, regulatory_authority="AICTE_UGC")
    row_b = _row(eligibility_upload_setup, regulatory_authority="UGC")
    response = _upload_validate(client, eligibility_upload_setup["hr_admin"], [row_a, row_b])
    body = response.json()
    assert body["created_count"] == 2
    assert body["rejected_count"] == 0


def test_validate_forbidden_for_non_write_role(client, eligibility_upload_setup):
    response = _upload_validate(client, eligibility_upload_setup["hod"], [_row(eligibility_upload_setup)])
    assert response.status_code == 403


# --- commit: writes + BulkUploadRowLog -------------------------------------


def test_commit_creates_row_and_log(client, eligibility_upload_setup, db_session):
    response = _upload_commit(client, eligibility_upload_setup["hr_admin"], [_row(eligibility_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    log_id = uuid.UUID(body["bulk_upload_log_id"])

    row = db_session.query(EligibilityRule).one()
    assert row.position_title == "Assistant Professor"
    assert row.campus_id == eligibility_upload_setup["campus"].id
    assert row.department_id == eligibility_upload_setup["department"].id
    assert row.status.value == "DRAFT"
    assert row.is_active is True
    assert row.verification_required is True

    log = db_session.get(BulkUploadLog, log_id)
    assert log.entity_type.value == "ELIGIBILITY_RULE"
    assert log.rows_created == 1
    assert log.stored_file_object_key is not None


def test_commit_succeeds_with_a_storage_warning_when_object_storage_is_unavailable(
    client, eligibility_upload_setup, db_session, fake_minio_client
):
    fake_minio_client.fail_puts = True

    response = _upload_commit(client, eligibility_upload_setup["hr_admin"], [_row(eligibility_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["created_count"] == 1
    assert db_session.query(EligibilityRule).count() == 1

    assert body["storage_warning"] == (
        "Workbook storage is temporarily unavailable. The file was successfully parsed, "
        "but the original workbook could not be archived."
    )

    log_id = uuid.UUID(body["bulk_upload_log_id"])
    log = db_session.get(BulkUploadLog, log_id)
    assert log.stored_file_object_key is None


def test_commit_skips_rejected_rows(client, eligibility_upload_setup, db_session):
    good = _row(eligibility_upload_setup)
    bad = _row(eligibility_upload_setup)
    bad[0] = "ZZZ"
    response = _upload_commit(client, eligibility_upload_setup["hr_admin"], [good, bad])
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert db_session.query(EligibilityRule).count() == 1


def test_commit_forbidden_for_non_write_role(client, eligibility_upload_setup):
    response = _upload_commit(client, eligibility_upload_setup["hod"], [_row(eligibility_upload_setup)])
    assert response.status_code == 403


# --- template -----------------------------------------------------------


def test_template_download_is_xlsx(client, eligibility_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, eligibility_upload_setup["hr_admin"])
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_template_forbidden_for_non_write_role(client, eligibility_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, eligibility_upload_setup["hod"])
    )
    assert response.status_code == 403
