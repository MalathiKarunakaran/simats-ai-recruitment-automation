"""Talent pool sheet sync (docs/specs/talent-pool-sheet-sync.md step 2).

Headers are the live sheet's, read 2026-10-29: the Final tab's row 2 and the
NTS tab's row 1 (whose column A, P and Q have no header).
"""

from datetime import date

import pytest

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.enums import TALENT_POOL_SYNCED_ACTION, TalentPoolSourceTabEnum, UserRoleEnum
from app.models.talent_pool_entry import TalentPoolEntry

from tests.conftest import auth_headers

SECRET = "test-talent-pool-sync-secret"
URL = "/api/v1/talent-pool/sync"

FINAL_HEADERS = [
    "S.No", "Data", "Applied Date", "Mail ID", "Name", "Phone Number", "Actual Dept", "Google Link",
    "PhD / Eligible Status", "Mail Status", "Date Of Birth", "Age", "Location", "Status", "Date of Interview",
    "Month / Year", "General Remark", "2nd Time Applied Date", "Interview Called by",
]  # fmt: skip
NTS_HEADERS = [
    "", "Name", "Phone No", "Mail ID", "Applied Post", "Department", "Reference Given Date", "Reference",
    "Call Date/ Mail Sent Date", "Call/Mail", "Interview Schduled Date", "Interview Mode (Online/Offline)",
    "General Remark", "Status", "Remarks", "", "", "Final Status",
]  # fmt: skip


@pytest.fixture(autouse=True)
def _configured_secret(monkeypatch):
    monkeypatch.setattr(settings, "TALENT_POOL_SYNC_SECRET", SECRET)


def final_row(n, *, name="Asha R", email="asha@example.com", dept="CSE", status="Selected", applied="05-03-2025",
              eligibility="With Ph.D", phone="9876543210", remark=""):  # fmt: skip
    cells = [""] * len(FINAL_HEADERS)
    for header, value in {
        "S.No": str(n), "Data": "Mam Data", "Applied Date": applied, "Mail ID": email, "Name": name,
        "Phone Number": phone, "Actual Dept": dept, "Google Link": "https://drive.example/cv",
        "PhD / Eligible Status": eligibility, "Status": status, "Date of Interview": "12/13-9-25",
        "General Remark": remark, "Interview Called by": "Narmada",
    }.items():  # fmt: skip
        cells[FINAL_HEADERS.index(header)] = value
    return {"row_number": n + 2, "cells": cells}


def final(rows, **kw):
    return {
        "source_tab": "TEACHING_FINAL",
        "sheet_last_update": "29-10-2026, 04.31 pm",
        "headers": FINAL_HEADERS,
        "rows": rows,
        **kw,
    }


def post(client, payload, secret=SECRET):
    headers = {"X-Talent-Pool-Sync-Secret": secret} if secret is not None else {}
    return client.post(URL, json=payload, headers=headers)


def entries(db_session, tab=TalentPoolSourceTabEnum.TEACHING_FINAL):
    db_session.expire_all()
    return (
        db_session.query(TalentPoolEntry)
        .filter_by(source_tab=tab)
        .order_by(TalentPoolEntry.sheet_row_number)
        .all()
    )


# --- Gate -----------------------------------------------------------------


def test_unset_secret_refuses_everything(client, monkeypatch):
    monkeypatch.setattr(settings, "TALENT_POOL_SYNC_SECRET", "")
    assert post(client, final([final_row(1)])).status_code == 503


@pytest.mark.parametrize("secret", [None, "wrong"])
def test_missing_or_wrong_secret_is_401(client, db_session, secret):
    assert post(client, final([final_row(1)]), secret=secret).status_code == 401
    assert entries(db_session) == []


def test_a_user_token_is_not_the_secret(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(URL, json=final([final_row(1)]), headers=auth_headers(client, admin))
    assert response.status_code == 401


# --- Mapping --------------------------------------------------------------


def test_final_row_is_normalised(client, db_session):
    response = post(client, final([final_row(1, dept="MCA CSE", status="Eligible", eligibility="With PH.D")]))
    assert response.status_code == 200, response.text
    [entry] = entries(db_session)
    assert entry.full_name == "Asha R"
    assert entry.email == "asha@example.com"
    assert entry.source == "Mam Data"
    assert entry.applied_on == date(2025, 3, 5)
    assert (entry.dept_raw, entry.dept_group) == ("MCA CSE", "CSE")
    assert (entry.eligibility_raw, entry.eligibility) == ("With PH.D", "With Ph.D")
    assert entry.sheet_status == "Pending"
    assert entry.interview_on_raw == "12/13-9-25"
    assert entry.called_by == "Narmada"
    assert entry.resume_url == "https://drive.example/cv"
    assert entry.sheet_row_number == 3
    assert entry.raw["Actual Dept"] == "MCA CSE"
    assert entry.row_key and entry.content_hash


def test_nts_row_uses_final_status_dates_and_both_remarks(client, db_session):
    cells = [""] * len(NTS_HEADERS)
    for header, value in {
        "Name": "Ravi K", "Phone No": "9000000001", "Mail ID": "ravi@example.com", "Applied Post": "Hostel Warden",
        "Department": "", "Reference": "Indeed", "Call Date/ Mail Sent Date": "Need to call",
        "Interview Schduled Date": "13-9-25", "General Remark": "Good", "Status": "selected", "Remarks": "Call back",
        "Final Status": "",
    }.items():  # fmt: skip
        cells[NTS_HEADERS.index(header)] = value
    payload = {"source_tab": "NTS", "headers": NTS_HEADERS, "rows": [{"row_number": 2, "cells": cells}]}
    response = post(client, payload)
    assert response.status_code == 200, response.text
    [entry] = entries(db_session, TalentPoolSourceTabEnum.NTS)
    assert entry.applied_post == "Hostel Warden"
    assert entry.dept_raw is None and entry.dept_group is None
    assert entry.source == "Indeed"
    assert entry.applied_on == date(2025, 9, 13)  # column I has no date, so K
    assert (entry.sheet_status, entry.status_from_remark) == ("Selected", True)
    assert entry.remarks == "Good · Call back"
    assert entry.eligibility is None
    # The three untitled columns keep their cells under their own names.
    assert {"Column A", "Column P", "Column Q"} <= set(entry.raw)


def test_columns_are_found_by_name_not_position(client, db_session):
    headers = list(reversed(FINAL_HEADERS))
    row = final_row(1)
    row["cells"] = list(reversed(row["cells"]))
    assert post(client, final([row], headers=headers)).status_code == 200
    assert entries(db_session)[0].full_name == "Asha R"


def test_missing_name_header_refuses_the_snapshot(client, db_session):
    headers = ["Applicant" if h == "Name" else h for h in FINAL_HEADERS]
    response = post(client, final([final_row(1)], headers=headers))
    assert response.status_code == 422
    assert entries(db_session) == []


def test_other_missing_headers_are_reported(client):
    headers = ["Dept" if h == "Actual Dept" else h for h in FINAL_HEADERS]
    body = post(client, final([final_row(1)], headers=headers)).json()
    assert body["missing_headers"] == ["Actual Dept"]


# --- Upsert ---------------------------------------------------------------


def test_replaying_a_snapshot_changes_nothing(client, db_session):
    snapshot = final([final_row(1), final_row(2, name="Bala K", email="bala@example.com")])
    first = post(client, snapshot).json()["counts"]
    assert (first["inserted"], first["unchanged"]) == (2, 0)
    second = post(client, snapshot).json()["counts"]
    assert (second["inserted"], second["updated"], second["unchanged"], second["deactivated"]) == (0, 0, 2, 0)
    assert len(entries(db_session)) == 2


def test_an_edited_cell_updates_the_same_row(client, db_session):
    post(client, final([final_row(1, status="")]))
    [before] = entries(db_session)
    counts = post(client, final([final_row(1, status="Selected")])).json()["counts"]
    assert counts["updated"] == 1
    [after] = entries(db_session)
    assert after.id == before.id
    assert after.sheet_status == "Selected"


def test_reordering_the_sheet_keeps_identity(client, db_session):
    a, b = final_row(1), final_row(2, name="Bala K", email="bala@example.com")
    post(client, final([a, b]))
    ids = {e.full_name: e.id for e in entries(db_session)}
    a2, b2 = dict(a, row_number=4), dict(b, row_number=3)
    counts = post(client, final([b2, a2])).json()["counts"]
    assert counts["inserted"] == 0 and counts["deactivated"] == 0
    assert {e.full_name: e.id for e in entries(db_session)} == ids


def test_removed_rows_are_deactivated_and_come_back(client, db_session):
    a, b = final_row(1), final_row(2, name="Bala K", email="bala@example.com")
    post(client, final([a, b]))
    counts = post(client, final([a])).json()["counts"]
    assert counts["deactivated"] == 1
    assert {(e.full_name, e.is_active) for e in entries(db_session)} == {("Asha R", True), ("Bala K", False)}

    counts = post(client, final([a, b])).json()["counts"]
    assert counts["reactivated"] == 1
    assert all(e.is_active for e in entries(db_session))


def test_hand_entered_rows_are_never_touched(client, db_session):
    hand = TalentPoolEntry(
        source_tab=TalentPoolSourceTabEnum.TEACHING_FINAL, full_name="Entered By Hand", sheet_status="Selected"
    )
    db_session.add(hand)
    db_session.commit()
    post(client, final([final_row(1)]))
    post(client, final([]))  # an empty tab deactivates everything the sync wrote
    db_session.refresh(hand)
    assert hand.is_active is True
    assert hand.row_key is None
    assert hand.full_name == "Entered By Hand"


def test_tabs_are_independent(client, db_session):
    post(client, final([final_row(1)]))
    post(client, {"source_tab": "NTS", "headers": NTS_HEADERS, "rows": []})
    assert entries(db_session)[0].is_active is True


# --- Reporting ------------------------------------------------------------


def test_duplicates_are_kept_and_reported(client, db_session):
    body = post(client, final([final_row(1), final_row(2, status="Rejected")])).json()
    assert body["counts"]["duplicates"] == 1
    assert body["duplicate_rows"] == [{"row_number": 4, "same_as_row": 3}]
    assert len(entries(db_session)) == 2


def test_person_without_email_is_keyed_by_name_and_phone(client, db_session):
    rows = [
        final_row(1, email="", name="Chitra M", phone="98765 43210"),
        final_row(2, email="", name="Chitra M", phone="9876543210"),  # same digits: a repeat
        final_row(3, email="", name="Chitra M", phone="9123456789"),  # another person
    ]
    body = post(client, final(rows)).json()
    assert body["counts"]["duplicates"] == 1
    assert len(entries(db_session)) == 3


def test_nameless_rows_are_skipped_and_reported(client, db_session):
    body = post(client, final([final_row(1), final_row(2, name="  ")])).json()
    assert body["skipped_rows"] == [{"row_number": 4, "reason": "no name"}]
    assert body["counts"]["skipped"] == 1
    assert len(entries(db_session)) == 1


def test_unmapped_departments_and_nts_eligibility_are_reported(client, db_session):
    body = post(client, final([final_row(1, dept="M.E CSE"), final_row(2, email="b@example.com", eligibility="NTS")]))
    body = body.json()
    assert body["unmapped_departments"] == ["M.E CSE"]
    assert body["notes"] == [{"row_number": 4, "reason": "eligibility says NTS"}]
    unmapped = next(e for e in entries(db_session) if e.dept_raw == "M.E CSE")
    assert unmapped.dept_group is None


def test_a_long_cell_is_cut_not_fatal(client, db_session):
    assert post(client, final([final_row(1, dept="X" * 400)])).status_code == 200
    assert len(entries(db_session)[0].dept_raw) == 255


def test_sync_writes_the_audit_row_the_summary_reads(client, db_session, user_factory):
    post(client, final([final_row(1)]))
    row = db_session.query(AuditLog).filter_by(action=TALENT_POOL_SYNCED_ACTION).one()
    assert row.actor_user_id is None
    assert row.after_state["counts"]["inserted"] == 1

    admin = user_factory(UserRoleEnum.HR_ADMIN)
    db_session.commit()
    summary = client.get(
        "/api/v1/talent-pool/summary", params={"source_tab": "TEACHING_FINAL"}, headers=auth_headers(client, admin)
    ).json()
    assert summary["sheet_last_update"] == "29-10-2026, 04.31 pm"
    assert summary["last_sync_counts"]["inserted"] == 1
    assert summary["last_sync_at"] is not None
