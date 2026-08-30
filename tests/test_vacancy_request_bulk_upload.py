"""Vacancy Request bulk upload -- validate / preview / commit / undo
(2026-08-30).

This joins the existing six-entity BulkUpload framework rather than adding a
third one-shot importer, but it is the odd one out in that framework and these
tests exist mostly to pin the two ways it differs:

1. **Create-only.** Every other entity there is master data, where a
   re-uploaded row should upsert. A vacancy request is an EVENT -- two
   identical rows are two genuine requests, not a duplicate -- so re-uploading
   the same file creates more requests rather than matching existing ones, and
   `updated_count`/`unchanged_count` are always 0.

2. **Undo cancels DRAFTS, it does not soft-delete.** VacancyRequest has no
   `is_active`; it has a status lifecycle. And unlike a Location, a row can
   move on by itself inside the 24h window, so anything past DRAFT is left
   alone rather than being yanked out of an approval chain.
"""

import io
import uuid

import pytest
from openpyxl import Workbook

from app.models.enums import (
    BulkUploadEntityTypeEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
    VacancyRequestSourceEnum,
    VacancyRequestStatusEnum,
)
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers

TEMPLATE = "/api/v1/vacancy-requests/bulk-upload/template"
VALIDATE = "/api/v1/vacancy-requests/bulk-upload/validate"
COMMIT = "/api/v1/vacancy-requests/bulk-upload/commit"

HEADERS = (
    "Campus Code",
    "Department Name",
    "Designation",
    "Number of Positions",
    "Priority",
    "Required By (DD-MM-YYYY)",
    "Justification",
)


def _workbook(rows: list[tuple]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(client, actor, url, rows):
    return client.post(
        url,
        headers=auth_headers(client, actor),
        files={
            "file": (
                "vacancy_requests.xlsx",
                _workbook(rows),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


@pytest.fixture()
def bulk_setup(campus_factory, department_factory, designation_factory, user_factory, db_session):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Bulk Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(
        StaffRoleCategoryEnum.TEACHING, name=f"Bulk Desig {uuid.uuid4().hex[:6]}", department=department
    )
    actor = user_factory(UserRoleEnum.SUPER_ADMIN)
    db_session.commit()
    return campus, department, designation, actor


# --- template -----------------------------------------------------------------


def test_template_downloads_as_a_workbook(client, bulk_setup):
    _c, _d, _des, actor = bulk_setup
    response = client.get(TEMPLATE, headers=auth_headers(client, actor))

    assert response.status_code == 200
    assert response.content[:2] == b"PK"  # xlsx is a zip
    assert "vacancy_request_bulk_upload_template.xlsx" in response.headers["content-disposition"]


# --- validate is a pure preview ----------------------------------------------


def test_validate_previews_without_writing_anything(client, bulk_setup, db_session):
    campus, department, designation, actor = bulk_setup
    before = db_session.query(VacancyRequest).count()

    response = _upload(
        client, actor, VALIDATE, [("SSE", department.name, designation.name, 2, "NORMAL", "01-04-2026", "Growth")]
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["created_count"] == 1
    assert body["rejected_count"] == 0
    # The whole point of a preview.
    assert db_session.query(VacancyRequest).count() == before


def test_validate_never_reports_updated_or_unchanged(client, bulk_setup):
    """Create-only: those two counts exist for shape parity with the
    master-data importers and can never be non-zero here."""
    campus, department, designation, actor = bulk_setup
    row = ("SSE", department.name, designation.name, 1, "NORMAL", "", "Need one")

    _upload(client, actor, COMMIT, [row])
    # The SAME row again -- a master-data importer would call this "unchanged".
    body = _upload(client, actor, VALIDATE, [row]).json()

    assert body["created_count"] == 1
    assert body["updated_count"] == 0
    assert body["unchanged_count"] == 0


# --- row-level validation -----------------------------------------------------


@pytest.mark.parametrize(
    "row,fragment",
    [
        (("XXX", "Any Dept", "Any Desig", 1, "NORMAL", "", "x"), "unknown campus code"),
        (("SSE", "No Such Dept", "Any Desig", 1, "NORMAL", "", "x"), "unknown department"),
        (("SSE", None, None, 1, "NORMAL", "", "x"), "are all required"),
    ],
)
def test_rejects_bad_master_data_with_a_readable_reason(client, bulk_setup, row, fragment):
    campus, department, designation, actor = bulk_setup
    # Substitute the real department/designation names where the case needs them.
    concrete = tuple(
        department.name if v == "Any Dept" else designation.name if v == "Any Desig" else v for v in row
    )

    body = _upload(client, actor, VALIDATE, [concrete]).json()

    assert body["rejected_count"] == 1
    assert fragment in body["rows"][0]["error_reason"].lower()


def test_rejects_a_designation_the_department_does_not_support(
    client, bulk_setup, designation_factory, db_session
):
    """MEMBERSHIP, not equality -- the rule CLAUDE.md calls out as the
    original bug."""
    campus, department, _designation, actor = bulk_setup
    housekeeping = designation_factory(
        StaffRoleCategoryEnum.HOUSEKEEPING, name=f"HK {uuid.uuid4().hex[:6]}", department=department
    )
    db_session.commit()

    body = _upload(
        client, actor, VALIDATE, [("SSE", department.name, housekeeping.name, 1, "NORMAL", "", "x")]
    ).json()

    assert body["rejected_count"] == 1
    assert "does not support" in body["rows"][0]["error_reason"].lower()


@pytest.mark.parametrize("count,fragment", [(0, "1 or more"), (101, "cannot exceed"), ("abc", "1 or more")])
def test_rejects_an_impossible_position_count(client, bulk_setup, count, fragment):
    campus, department, designation, actor = bulk_setup

    body = _upload(
        client, actor, VALIDATE, [("SSE", department.name, designation.name, count, "NORMAL", "", "x")]
    ).json()

    assert body["rejected_count"] == 1
    assert fragment in body["rows"][0]["error_reason"].lower()


def test_rejects_an_unreadable_date(client, bulk_setup):
    campus, department, designation, actor = bulk_setup

    body = _upload(
        client, actor, VALIDATE, [("SSE", department.name, designation.name, 1, "NORMAL", "not-a-date", "x")]
    ).json()

    assert body["rejected_count"] == 1
    assert "date" in body["rows"][0]["error_reason"].lower()


# --- commit -------------------------------------------------------------------


def test_commit_creates_drafts_attributed_to_the_uploader(client, bulk_setup, db_session):
    campus, department, designation, actor = bulk_setup

    response = _upload(
        client, actor, COMMIT, [("SSE", department.name, designation.name, 3, "HIGH", "01-04-2026", "Expansion")]
    )
    assert response.status_code == 200, response.text
    assert response.json()["created_count"] == 1

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.department_id == department.id).one()
    # DRAFT, not submitted -- submit() enforces the sanction ceiling per
    # request and would leave a batch half in the approval queue.
    assert vr.status == VacancyRequestStatusEnum.DRAFT
    assert vr.source == VacancyRequestSourceEnum.BULK_UPLOAD
    assert vr.requested_by_id == actor.id
    assert vr.requested_count == 3
    assert vr.priority.value == "HIGH"
    # Taken from Designation Master, as the QR intake also does.
    assert vr.position_title == designation.name
    assert vr.qualification == designation.qualification


def test_commit_writes_nothing_for_rejected_rows(client, bulk_setup, db_session):
    campus, department, designation, actor = bulk_setup

    body = _upload(
        client,
        actor,
        COMMIT,
        [
            ("SSE", department.name, designation.name, 1, "NORMAL", "", "Good row"),
            ("XXX", department.name, designation.name, 1, "NORMAL", "", "Bad campus"),
        ],
    ).json()

    assert body["created_count"] == 1
    assert body["rejected_count"] == 1
    assert db_session.query(VacancyRequest).filter(VacancyRequest.department_id == department.id).count() == 1


def test_commit_records_the_batch_against_the_right_entity_type(client, bulk_setup, db_session):
    from app.models.bulk_upload_log import BulkUploadLog

    campus, department, designation, actor = bulk_setup

    log_id = _upload(
        client, actor, COMMIT, [("SSE", department.name, designation.name, 1, "NORMAL", "", "x")]
    ).json()["bulk_upload_log_id"]

    log = db_session.get(BulkUploadLog, uuid.UUID(log_id))
    assert log.entity_type == BulkUploadEntityTypeEnum.VACANCY_REQUEST
    assert log.rows_created == 1


def test_reuploading_the_same_file_creates_more_requests(client, bulk_setup, db_session):
    """The create-only property, end to end: a request is an event, so the
    second upload is two more real requests, not a no-op."""
    campus, department, designation, actor = bulk_setup
    row = ("SSE", department.name, designation.name, 1, "NORMAL", "", "Twice")

    _upload(client, actor, COMMIT, [row, row])
    _upload(client, actor, COMMIT, [row, row])

    assert db_session.query(VacancyRequest).filter(VacancyRequest.department_id == department.id).count() == 4


# --- undo ---------------------------------------------------------------------


def _undo(client, actor, log_id):
    return client.post(f"/api/v1/sanctioned-strength/bulk-uploads/{log_id}/undo", headers=auth_headers(client, actor))


def test_undo_cancels_the_drafts_it_created(client, bulk_setup, db_session):
    campus, department, designation, actor = bulk_setup
    log_id = _upload(
        client, actor, COMMIT, [("SSE", department.name, designation.name, 1, "NORMAL", "", "x")]
    ).json()["bulk_upload_log_id"]

    response = _undo(client, actor, log_id)
    assert response.status_code == 200, response.text
    assert response.json()["reverted_history_count"] == 1
    assert response.json()["not_reverted_count"] == 0

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.department_id == department.id).one()
    # CANCELLED, not soft-deleted -- there is no is_active on this model.
    assert vr.status == VacancyRequestStatusEnum.CANCELLED
    assert vr.cancelled_by_id == actor.id
    assert "undone" in (vr.cancellation_reason or "").lower()


def test_undo_leaves_a_request_that_has_already_moved_on(client, bulk_setup, db_session):
    """A row can be submitted inside the 24h undo window. Cancelling it then
    would be destructive, not an undo -- it is counted, not touched."""
    campus, department, designation, actor = bulk_setup
    log_id = _upload(
        client,
        actor,
        COMMIT,
        [
            ("SSE", department.name, designation.name, 1, "NORMAL", "", "Stays draft"),
            ("SSE", department.name, designation.name, 1, "NORMAL", "", "Gets submitted"),
        ],
    ).json()["bulk_upload_log_id"]

    moved_on = (
        db_session.query(VacancyRequest)
        .filter(VacancyRequest.remarks == "Gets submitted")
        .one()
    )
    moved_on.status = VacancyRequestStatusEnum.SUBMITTED
    db_session.commit()

    body = _undo(client, actor, log_id).json()

    assert body["reverted_history_count"] == 1
    assert body["not_reverted_count"] == 1
    db_session.refresh(moved_on)
    assert moved_on.status == VacancyRequestStatusEnum.SUBMITTED
