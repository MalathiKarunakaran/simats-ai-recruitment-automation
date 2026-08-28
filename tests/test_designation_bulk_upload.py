"""Designation bulk upload (Designation Master bulk-upload epic, backend
Phase 1) -- validate/commit/template, backed by
app/services/designation_import.py and the new endpoints in
app/api/v1/routers/designations.py. Shared-endpoint (list/error-report/undo)
entity-agnostic behavior for DESIGNATION batches is covered in
tests/test_bulk_upload_shared_endpoints.py, not duplicated here.
"""

import csv
import io
import uuid

import pytest

from app.models.bulk_upload_log import BulkUploadLog
from app.models.designation import Designation
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/designations"

HEADERS = [
    "Designation Name",
    "Category",
    "Department Codes",
    "Minimum Qualification",
    "Minimum Experience",
    "Employment Type",
    "Required Skills",
    "Active",
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
def designation_upload_setup(campus_factory, department_factory, user_factory):
    campus = campus_factory("SSE")
    department = department_factory(
        "SSE", name="Computer Science", code="CSE", category=StaffRoleCategoryEnum.TEACHING
    )
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    # HR_ADMIN can write Departments but NOT Designations
    # (DESIGNATION_WRITE_ROLES = {SUPER_ADMIN, RECRUITMENT_COORDINATOR} is a
    # deliberately different pairing than Department's own write roles) --
    # used below as the non-write-role actor.
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    return {
        "campus": campus,
        "department": department,
        "super_admin": super_admin,
        "coordinator": coordinator,
        "hr_admin": hr_admin,
    }


def _row(
    setup,
    name="Assistant Professor",
    category="TEACHING",
    department_codes="CSE",
    qualification="PhD in relevant field",
    min_experience="3+ years",
    employment_type="FULL_TIME",
    required_skills="Curriculum design",
    active="TRUE",
):
    return [name, category, department_codes, qualification, min_experience, employment_type, required_skills, active]


# --- validate: read-only, DB untouched --------------------------------------


def test_validate_new_row_is_created_and_writes_nothing(client, designation_upload_setup, db_session):
    response = _upload_validate(client, designation_upload_setup["super_admin"], [_row(designation_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["rows"][0]["status"] == "created"
    assert body["rows"][0]["department_codes"] == ["CSE"]
    assert db_session.query(Designation).count() == 0
    assert db_session.query(BulkUploadLog).count() == 0


def _make_matching_designation(db_session, setup):
    """Builds a Designation row whose fields exactly match `_row(setup)`'s
    own defaults -- `designation_factory` (tests/conftest.py) has its own,
    different default qualification/min_experience/employment_type, so it
    can't be reused directly for an "identical, therefore unchanged" case."""
    designation = Designation(
        name="Assistant Professor",
        category=StaffRoleCategoryEnum.TEACHING,
        qualification="PhD in relevant field",
        min_experience="3+ years",
        employment_type=EmploymentTypeEnum.FULL_TIME,
        required_skills="Curriculum design",
        is_active=True,
    )
    designation.departments = [setup["department"]]
    db_session.add(designation)
    db_session.flush()
    return designation


def test_validate_existing_row_identical_is_unchanged(client, designation_upload_setup, db_session):
    _make_matching_designation(db_session, designation_upload_setup)
    response = _upload_validate(client, designation_upload_setup["super_admin"], [_row(designation_upload_setup)])
    body = response.json()
    assert body["unchanged_count"] == 1, body
    assert body["rows"][0]["status"] == "unchanged"


@pytest.mark.parametrize(
    "field,value",
    [
        ("qualification", "M.Tech in relevant field"),
        ("min_experience", "5+ years"),
        ("employment_type", "ADJUNCT"),
        ("required_skills", "New skill set"),
        ("active", "FALSE"),
    ],
)
def test_validate_existing_row_with_changed_field_is_updated(
    client, designation_upload_setup, db_session, field, value
):
    _make_matching_designation(db_session, designation_upload_setup)
    kwargs = {
        "qualification": "PhD in relevant field",
        "min_experience": "3+ years",
        "employment_type": "FULL_TIME",
        "required_skills": "Curriculum design",
        "active": "TRUE",
    }
    kwargs[field] = value
    response = _upload_validate(
        client, designation_upload_setup["super_admin"], [_row(designation_upload_setup, **kwargs)]
    )
    body = response.json()
    assert body["updated_count"] == 1, body


def test_validate_changed_name_creates_a_new_designation_not_an_update(
    client, designation_upload_setup, designation_factory
):
    """The natural key is (Name, Category) -- a changed Name is a DIFFERENT
    designation identity entirely, not an update of the old one (unlike
    Department's own (Campus, Code) key, where Name is deliberately excluded
    from the identity)."""
    designation_factory(
        StaffRoleCategoryEnum.TEACHING,
        name="Old Title",
        department=designation_upload_setup["department"],
    )
    response = _upload_validate(
        client, designation_upload_setup["super_admin"], [_row(designation_upload_setup, name="New Title")]
    )
    body = response.json()
    assert body["created_count"] == 1
    assert body["updated_count"] == 0


def test_same_name_different_category_is_not_a_duplicate(client, designation_upload_setup, department_factory):
    non_teaching_dept = department_factory(
        "SSE", name="Administration", code="ADMIN", category=StaffRoleCategoryEnum.NON_TEACHING
    )
    teaching_row = _row(designation_upload_setup, name="Coordinator", category="TEACHING", department_codes="CSE")
    non_teaching_row = _row(
        designation_upload_setup, name="Coordinator", category="NON_TEACHING", department_codes="ADMIN"
    )
    response = _upload_validate(client, designation_upload_setup["super_admin"], [teaching_row, non_teaching_row])
    body = response.json()
    assert body["created_count"] == 2
    assert body["rejected_count"] == 0


def test_validate_identical_repeated_row_is_merged_not_rejected(client, designation_upload_setup):
    """An exact repeat contributes no new departments, so it folds into the
    first row rather than being rejected -- nothing is lost either way, but
    "merged" is the honest description of what happened."""
    row = _row(designation_upload_setup)
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row, list(row)])
    body = response.json()
    assert body["created_count"] == 1
    assert body["merged_count"] == 1
    assert body["rejected_count"] == 0
    assert body["rows"][1]["status"] == "merged"
    assert body["rows"][1]["merged_into_row"] == 2
    assert body["rows"][1]["error_reason"] is None


def test_validate_duplicate_key_in_file_is_case_insensitive_on_name(client, designation_upload_setup):
    row_a = _row(designation_upload_setup, name="Assistant Professor")
    row_b = _row(designation_upload_setup, name="assistant professor")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row_a, row_b])
    body = response.json()
    assert body["created_count"] == 1
    assert body["merged_count"] == 1
    assert body["rejected_count"] == 0


def test_one_row_per_department_unions_instead_of_rejecting(
    client, designation_upload_setup, department_factory, db_session
):
    """The real user-reported case (2026-08-27): writing one row per
    department is the natural reading of the spec wording. Previously the
    second row was rejected as a duplicate and its department link silently
    lost. Now both departments are linked."""
    department_factory("SSE", name="AI & DS", code="AIDS", category=StaffRoleCategoryEnum.TEACHING)
    aids_row = _row(designation_upload_setup, name="Assistant Professor (SG)", department_codes="AIDS")
    cse_row = _row(designation_upload_setup, name="Assistant Professor (SG)", department_codes="CSE")

    body = _upload_validate(client, designation_upload_setup["super_admin"], [aids_row, cse_row]).json()
    assert body["rejected_count"] == 0
    assert body["created_count"] == 1
    assert body["merged_count"] == 1
    # The primary row's preview shows the full combined set, so the user can
    # see what will actually be linked.
    assert sorted(body["rows"][0]["department_codes"]) == ["AIDS", "CSE"]
    assert body["rows"][1]["status"] == "merged"
    assert body["rows"][1]["merged_into_row"] == 2

    _upload_commit(client, designation_upload_setup["super_admin"], [aids_row, cse_row])
    created = db_session.query(Designation).filter(Designation.name == "Assistant Professor (SG)").one()
    assert sorted(department.code for department in created.departments) == ["AIDS", "CSE"]


def test_grouped_rows_disagreeing_on_a_designation_field_are_rejected(
    client, designation_upload_setup, department_factory
):
    """Department codes may differ across a group -- that is the point. A
    field describing the designation itself may not, because there is no
    honest way to pick a winner."""
    department_factory("SSE", name="AI & DS", code="AIDS", category=StaffRoleCategoryEnum.TEACHING)
    first = _row(designation_upload_setup, department_codes="CSE", qualification="PhD in relevant field")
    conflicting = _row(designation_upload_setup, department_codes="AIDS", qualification="M.Tech")

    body = _upload_validate(client, designation_upload_setup["super_admin"], [first, conflicting]).json()
    assert body["created_count"] == 1
    assert body["merged_count"] == 0
    assert body["rejected_count"] == 1
    reason = body["rows"][1]["error_reason"]
    assert "Minimum Qualification" in reason
    assert "row 2" in reason.lower() or "Row 2" in reason
    # The rejected row contributed nothing, so only its own department stays out.
    assert body["rows"][0]["department_codes"] == ["CSE"]


def test_merged_rows_do_not_double_count_undo(client, designation_upload_setup, department_factory, db_session):
    """A merged row writes nothing of its own, so the group must produce
    exactly one row log -- otherwise undo would try to revert the same
    designation twice."""
    department_factory("SSE", name="AI & DS", code="AIDS", category=StaffRoleCategoryEnum.TEACHING)
    rows = [
        _row(designation_upload_setup, name="Professor (OG)", department_codes="AIDS"),
        _row(designation_upload_setup, name="Professor (OG)", department_codes="CSE"),
    ]
    body = _upload_commit(client, designation_upload_setup["super_admin"], rows).json()

    from app.models.bulk_upload_row_log import BulkUploadRowLog

    logs = (
        db_session.query(BulkUploadRowLog)
        .filter(BulkUploadRowLog.bulk_upload_log_id == uuid.UUID(body["bulk_upload_log_id"]))
        .all()
    )
    assert len(logs) == 1


def test_validate_missing_name_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup)
    row[0] = ""
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Designation Name" in body["rows"][0]["error_reason"]


def test_validate_missing_category_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup)
    row[1] = ""
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Category" in body["rows"][0]["error_reason"]


def test_validate_invalid_category_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup, category="BOGUS")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Category" in body["rows"][0]["error_reason"]


@pytest.mark.parametrize("value", ["NON-TEACHING", "NON_TEACHING", "Non Teaching", "non teaching"])
def test_validate_category_is_hyphen_and_case_tolerant(client, designation_upload_setup, department_factory, value):
    department_factory("SSE", name="Admin Wing", code="ADMWING", category=StaffRoleCategoryEnum.NON_TEACHING)
    row = _row(designation_upload_setup, category=value, department_codes="ADMWING")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0, body
    assert body["rows"][0]["category"] == "NON_TEACHING"


def test_validate_missing_qualification_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup)
    row[3] = ""
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Minimum Qualification" in body["rows"][0]["error_reason"]


def test_validate_missing_min_experience_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup)
    row[4] = ""
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Minimum Experience" in body["rows"][0]["error_reason"]


def test_validate_missing_employment_type_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup)
    row[5] = ""
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Employment Type" in body["rows"][0]["error_reason"]


def test_validate_invalid_employment_type_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup, employment_type="FREELANCE")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Employment Type" in body["rows"][0]["error_reason"]


def test_validate_blank_department_codes_is_allowed(client, designation_upload_setup):
    row = _row(designation_upload_setup, department_codes="")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0, body
    assert body["rows"][0]["department_codes"] == []


def test_validate_unknown_department_code_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup, department_codes="NOPE")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "Unknown department code 'NOPE'" in body["rows"][0]["error_reason"]


def test_validate_department_code_category_mismatch_is_rejected(
    client, designation_upload_setup, department_factory
):
    department_factory("SSE", name="Facilities", code="FAC", category=StaffRoleCategoryEnum.HOUSEKEEPING)
    row = _row(designation_upload_setup, category="TEACHING", department_codes="FAC")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "FAC" in body["rows"][0]["error_reason"]
    assert "Facilities" in body["rows"][0]["error_reason"]
    # The message now names the category the department does NOT support
    # (the designation's own), rather than the department's single category.
    assert "does not support TEACHING staff" in body["rows"][0]["error_reason"]


def test_validate_multiple_department_codes_split_by_comma_and_semicolon(
    client, designation_upload_setup, department_factory
):
    department_factory("SSE", name="Information Technology", code="IT", category=StaffRoleCategoryEnum.TEACHING)
    row = _row(designation_upload_setup, department_codes="CSE, IT")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0, body
    assert set(body["rows"][0]["department_codes"]) == {"CSE", "IT"}


def test_validate_department_code_resolves_across_multiple_campuses(
    client, designation_upload_setup, department_factory
):
    """A designation<->department mapping has no campus dimension --
    Department Codes are resolved globally, not scoped to one campus, so a
    single code shared by departments on different campuses links to all of
    them."""
    department_factory(
        "SHIFT", name="Computer Science (Shift Campus)", code="CSE", category=StaffRoleCategoryEnum.TEACHING
    )
    row = _row(designation_upload_setup, department_codes="CSE")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0, body


def test_validate_blank_active_defaults_to_true(client, designation_upload_setup):
    row = _row(designation_upload_setup, active="")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0
    assert body["rows"][0]["is_active"] is True


def test_validate_invalid_active_value_is_rejected(client, designation_upload_setup):
    row = _row(designation_upload_setup, active="MAYBE")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    assert "MAYBE" in body["rows"][0]["error_reason"]


def test_validate_forbidden_for_non_write_role(client, designation_upload_setup):
    response = _upload_validate(client, designation_upload_setup["hr_admin"], [_row(designation_upload_setup)])
    assert response.status_code == 403


def test_validate_allowed_for_recruitment_coordinator(client, designation_upload_setup):
    response = _upload_validate(client, designation_upload_setup["coordinator"], [_row(designation_upload_setup)])
    assert response.status_code == 200


# --- commit: writes + BulkUploadRowLog -------------------------------------


def test_commit_creates_row_and_log(client, designation_upload_setup, db_session):
    response = _upload_commit(client, designation_upload_setup["super_admin"], [_row(designation_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    log_id = uuid.UUID(body["bulk_upload_log_id"])

    row = db_session.query(Designation).one()
    assert row.name == "Assistant Professor"
    assert row.category == StaffRoleCategoryEnum.TEACHING
    assert row.required_skills == "Curriculum design"
    assert [dept.id for dept in row.departments] == [designation_upload_setup["department"].id]

    log = db_session.get(BulkUploadLog, log_id)
    assert log.entity_type.value == "DESIGNATION"
    assert log.rows_created == 1
    assert log.stored_file_object_key is not None


def test_commit_succeeds_with_a_storage_warning_when_object_storage_is_unavailable(
    client, designation_upload_setup, db_session, fake_minio_client
):
    fake_minio_client.fail_puts = True

    response = _upload_commit(client, designation_upload_setup["super_admin"], [_row(designation_upload_setup)])
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["created_count"] == 1
    assert db_session.query(Designation).count() == 1

    assert body["storage_warning"] == (
        "Workbook storage is temporarily unavailable. The file was successfully parsed, "
        "but the original workbook could not be archived."
    )

    log_id = uuid.UUID(body["bulk_upload_log_id"])
    log = db_session.get(BulkUploadLog, log_id)
    assert log.stored_file_object_key is None


def test_commit_update_replaces_department_list_not_merges(
    client, designation_upload_setup, designation_factory, department_factory, db_session
):
    """On an update, the row's Department Codes REPLACE the existing linked
    set entirely -- they are never unioned with whatever was there before
    (matching every other bulk-upload UPSERT's own full-row-overwrite
    convention)."""
    other_department = department_factory(
        "SSE", name="Mechanical Engineering", code="MECH", category=StaffRoleCategoryEnum.TEACHING
    )
    existing = designation_factory(
        StaffRoleCategoryEnum.TEACHING, name="Assistant Professor", department=other_department
    )
    db_session.commit()

    row = _row(designation_upload_setup, department_codes="CSE")
    response = _upload_commit(client, designation_upload_setup["super_admin"], [row])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["updated_count"] == 1
    assert db_session.query(Designation).count() == 1  # re-stamped in place, not a second row

    db_session.refresh(existing)
    department_ids = {dept.id for dept in existing.departments}
    assert department_ids == {designation_upload_setup["department"].id}
    assert other_department.id not in department_ids


def test_commit_update_blank_department_codes_clears_existing_links(
    client, designation_upload_setup, designation_factory, db_session
):
    existing = designation_factory(
        StaffRoleCategoryEnum.TEACHING, name="Assistant Professor", department=designation_upload_setup["department"]
    )
    db_session.commit()

    row = _row(designation_upload_setup, department_codes="")
    response = _upload_commit(client, designation_upload_setup["super_admin"], [row])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["updated_count"] == 1

    db_session.refresh(existing)
    assert existing.departments == []


def test_commit_skips_rejected_rows(client, designation_upload_setup, db_session):
    good = _row(designation_upload_setup)
    bad = _row(designation_upload_setup, name="Other Role", department_codes="NOPE")
    response = _upload_commit(client, designation_upload_setup["super_admin"], [good, bad])
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert db_session.query(Designation).count() == 1


def test_commit_forbidden_for_non_write_role(client, designation_upload_setup):
    response = _upload_commit(client, designation_upload_setup["hr_admin"], [_row(designation_upload_setup)])
    assert response.status_code == 403


# --- template -----------------------------------------------------------


def test_template_download_is_xlsx(client, designation_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, designation_upload_setup["super_admin"])
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_template_forbidden_for_non_write_role(client, designation_upload_setup):
    response = client.get(
        f"{ENDPOINT}/bulk-upload/template", headers=auth_headers(client, designation_upload_setup["hr_admin"])
    )
    assert response.status_code == 403


# --- multi-category departments (2026-08-28) --------------------------------
# A department is a place, not a staff category: CSE employs Assistant
# Professors (TEACHING) and Lab Assistants (NON_TEACHING) at the same time.
# Before `Department.supported_categories` these uploads were rejected
# outright, which is the bug the whole change exists to fix.


@pytest.fixture()
def mixed_department(department_factory):
    """CSE, supporting TEACHING and NON_TEACHING but NOT HOUSEKEEPING."""
    return department_factory(
        "SSE",
        # A distinct name from designation_upload_setup's own "Computer
        # Science" -- (campus_id, name) is uniquely constrained.
        name="Computer Science (Mixed)",
        code="CSEMIX",
        supported_categories=[StaffRoleCategoryEnum.TEACHING, StaffRoleCategoryEnum.NON_TEACHING],
    )


@pytest.mark.parametrize(
    ("name", "category"),
    [
        ("Assistant Professor", "TEACHING"),
        ("Lab Assistant", "NON_TEACHING"),
        ("Technical Assistant", "NON_TEACHING"),
    ],
)
def test_validate_accepts_any_category_the_department_supports(
    client, designation_upload_setup, mixed_department, name, category
):
    row = _row(designation_upload_setup, name=name, category=category, department_codes="CSEMIX")
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 0, body["rows"][0]["error_reason"]
    assert body["created_count"] == 1


def test_validate_rejects_a_category_the_department_does_not_support(
    client, designation_upload_setup, mixed_department
):
    # CSEMIX supports TEACHING and NON_TEACHING, but never HOUSEKEEPING.
    row = _row(
        designation_upload_setup,
        name="Housekeeping Attendant",
        category="HOUSEKEEPING",
        department_codes="CSEMIX",
    )
    response = _upload_validate(client, designation_upload_setup["super_admin"], [row])
    body = response.json()
    assert body["rejected_count"] == 1
    reason = body["rows"][0]["error_reason"]
    assert "CSEMIX" in reason
    assert "does not support HOUSEKEEPING staff" in reason


def test_commit_persists_a_non_teaching_designation_on_a_teaching_department(
    client, designation_upload_setup, mixed_department, db_session
):
    """The end-to-end shape of the reported failure: a NON_TEACHING Lab
    Assistant committed against a department that also holds TEACHING staff."""
    row = _row(
        designation_upload_setup, name="Lab Assistant", category="NON_TEACHING", department_codes="CSEMIX"
    )
    response = _upload_commit(client, designation_upload_setup["super_admin"], [row])
    assert response.status_code == 200, response.text
    assert response.json()["rejected_count"] == 0

    saved = db_session.query(Designation).filter(Designation.name == "Lab Assistant").one()
    assert saved.category == StaffRoleCategoryEnum.NON_TEACHING
    assert [department.code for department in saved.departments] == ["CSEMIX"]
