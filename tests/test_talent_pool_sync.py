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
from app.services import talent_pool_sync as sync

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


def _renamed_final_row(n, *, email):
    """The Final tab under its wording since 2026-11-03, with BioID, College and
    Mail Status among the columns."""
    values = {
        "S.No": str(n), "Reference": "Mam Data", "BioID": "", "Date": "05-03-2025", "Mail ID": email, "Name": "Asha R",
        "Phone NO": "9876543210", "College": "SSE", "Actual Dept": "CSE", "Resume Link": "https://drive.example/cv",
        "Ph.D Status": "With Ph.D", "Mail Status": "", "DoB": "", "Age": "", "Location": "", "Status": "Selected",
        "Interview Attended": "12/13-9-25", "Month/ Year": "", "General Remarks": "Good", "Second Time Status": "",
        "Followed byb": "Narmada",
    }  # fmt: skip
    return list(values), {"row_number": n + 2, "cells": list(values.values())}


def test_final_tab_is_read_under_its_current_column_names(client, db_session):
    headers, row = _renamed_final_row(1, email="asha@example.com")
    response = post(client, final([row], headers=headers))
    assert response.status_code == 200
    assert response.json()["missing_headers"] == []
    entry = entries(db_session)[0]
    assert entry.phone == "9876543210"
    assert entry.source == "Mam Data"
    assert entry.applied_on == date(2025, 3, 5)
    assert entry.resume_url == "https://drive.example/cv"
    assert entry.eligibility_raw == "With Ph.D"
    assert entry.interview_on_raw == "12/13-9-25"
    assert entry.remarks == "Good"
    assert entry.called_by == "Narmada"
    assert entry.raw["College"] == "SSE"


def test_renaming_columns_keeps_a_person_without_email_as_the_same_row(client, db_session):
    post(client, final([final_row(1, email="")]))
    before = entries(db_session)[0].id
    headers, row = _renamed_final_row(1, email="")
    counts = post(client, final([row], headers=headers)).json()["counts"]
    assert counts["deactivated"] == 0
    assert counts["inserted"] == 0
    assert entries(db_session)[0].id == before


def test_reading_a_row_differently_updates_it_though_its_cells_did_not_change(client, db_session, monkeypatch):
    post(client, final([final_row(1)]))
    assert entries(db_session)[0].dept_group == "CSE"

    monkeypatch.setattr(sync.normalise, "department_group", lambda raw: ("Computing", False))
    counts = post(client, final([final_row(1)])).json()["counts"]
    assert counts["updated"] == 1
    assert entries(db_session)[0].dept_group == "Computing"


def test_missing_name_header_refuses_the_snapshot(client, db_session):
    headers = ["Applicant" if h == "Name" else h for h in FINAL_HEADERS]
    response = post(client, final([final_row(1)], headers=headers))
    assert response.status_code == 422
    assert entries(db_session) == []


def test_any_missing_known_column_refuses_the_snapshot_and_keeps_the_data(client, db_session):
    post(client, final([final_row(1)]))
    headers = ["Dept" if h == "Actual Dept" else h for h in FINAL_HEADERS]
    response = post(client, final([final_row(1, dept="ECE")], headers=headers))
    assert response.status_code == 422
    assert "Actual Dept" in response.json()["detail"]
    entry = entries(db_session)[0]
    assert entry.dept_raw == "CSE"
    assert entry.is_active is True


def test_a_refused_snapshot_names_every_spelling_it_looked_for(client):
    headers = ["Mobile" if h == "Phone Number" else h for h in FINAL_HEADERS]
    detail = post(client, final([final_row(1)], headers=headers)).json()["detail"]
    assert "Phone Number / Phone NO" in detail


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


# --- Resume fields (2-Nov-2026) -----------------------------------------------


def _selected_with_resume(db_session, file_id, status="Selected", **raw):
    entry = TalentPoolEntry(
        source_tab=TalentPoolSourceTabEnum.TEACHING_FINAL, full_name="A", sheet_status=status, is_active=True, raw=raw,
        resume_url=f"https://drive.google.com/open?id={file_id}",
    )  # fmt: skip
    db_session.add(entry)
    db_session.flush()
    return entry


def _post_fields(client, items, secret=SECRET):
    return client.post("/api/v1/talent-pool/resume-fields", json={"items": items}, headers={"X-Talent-Pool-Sync-Secret": secret})


def _breakdown(client, user):
    r = client.get(
        "/api/v1/talent-pool/selected-breakdown",
        params={"source_tab": "TEACHING_FINAL"},
        headers=auth_headers(client, user),
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_resume_fields_need_the_secret(client):
    assert _post_fields(client, [], secret="wrong").status_code == 401


def test_resume_fields_reject_an_unknown_gender(client):
    assert _post_fields(client, [{"file_id": "F1", "gender": "unknown"}]).status_code == 422


def test_resume_fields_fill_the_charts_and_say_so(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    _selected_with_resume(db_session, "F1")
    _selected_with_resume(db_session, "F2")
    r = _post_fields(client, [
        {"file_id": "F1", "gender": "Female", "state": "Kerala", "country": "India"},
        {"file_id": "F2", "state": "Kerala", "country": "India"},
        {"file_id": "NOBODY", "state": "Goa"},
    ])  # fmt: skip
    assert r.status_code == 200, r.text
    assert r.json() == {
        "received": 3, "saved": 2, "no_matching_candidate": 1,
        "processed": 2, "state_filled": 2, "gender_filled": 1, "skipped": 0, "errors": 0,
    }

    b = _breakdown(client, admin)
    assert b["state"] == {"items": [{"label": "Kerala", "count": 2}], "recorded": 2, "from_resume": 2, "from_sheet": 0, "inferred": 2}
    assert b["gender"] == {"items": [{"label": "Female", "count": 1}], "recorded": 1, "from_resume": 1, "from_sheet": 0, "inferred": 1}
    assert b["department"]["from_resume"] == 0


def test_a_sheet_value_beats_the_resume(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    _selected_with_resume(db_session, "F1", State="Goa", Gender="Male")
    assert _post_fields(client, [{"file_id": "F1", "gender": "Female", "state": "Kerala"}]).status_code == 200

    b = _breakdown(client, admin)
    assert b["state"] == {"items": [{"label": "Goa", "count": 1}], "recorded": 1, "from_resume": 0, "from_sheet": 1, "inferred": 0}
    assert b["gender"] == {"items": [{"label": "Male", "count": 1}], "recorded": 1, "from_resume": 0, "from_sheet": 1, "inferred": 0}


def test_resume_fields_ignore_candidates_who_are_not_selected(client, db_session):
    _selected_with_resume(db_session, "F1", status="Rejected")
    assert _post_fields(client, [{"file_id": "F1", "state": "Kerala"}]).json()["saved"] == 0


def test_sending_again_overwrites(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    _selected_with_resume(db_session, "F1")
    _post_fields(client, [{"file_id": "F1", "state": "Goa"}])
    _post_fields(client, [{"file_id": "F1", "state": "Kerala"}])
    db_session.expire_all()
    assert _breakdown(client, admin)["state"]["items"] == [{"label": "Kerala", "count": 1}]


# --- Clue-based inference, hashes, sheet-only view (9-Nov-2026) ---------------

HEADERS = {"X-Talent-Pool-Sync-Secret": SECRET}


def _rows(client, user, path="/selected/rows", **params):
    r = client.get(
        f"/api/v1/talent-pool{path}",
        params={"source_tab": "TEACHING_FINAL", **params},
        headers=auth_headers(client, user),
    )
    assert r.status_code == 200, r.text
    return r.json()


def _row(client, user, entry, **params):
    return {row["id"]: row for row in _rows(client, user, **params)}[str(entry.id)]


def _stored(db_session, entry):
    from app.models.talent_pool_resume_field import TalentPoolResumeField

    db_session.expire_all()
    return db_session.get(TalentPoolResumeField, entry.id)


def test_old_payload_shape_still_works_and_is_recorded_as_the_original_reader(client, db_session):
    entry = _selected_with_resume(db_session, "F1")
    r = _post_fields(client, [{"file_id": "F1", "gender": "Female", "state": "Kerala", "country": "India"}])
    assert r.status_code == 200, r.text
    row = _stored(db_session, entry)
    assert (row.gender, row.state, row.country) == ("Female", "Kerala", "India")
    assert (row.legacy_gender, row.legacy_state, row.legacy_country) == ("Female", "Kerala", "India")
    assert (row.gender_source, row.gender_confidence, row.state_source) == ("resume_field", "high", "resume_address")
    assert row.gender_evidence is None and row.state_evidence is None and row.resume_hash is None


def test_clue_payload_stores_value_source_confidence_and_evidence(client, db_session):
    entry = _selected_with_resume(db_session, "F1")
    r = _post_fields(client, [{
        "file_id": "F1", "resume_hash": "h1",
        "clues": {"honorific": "Ms.", "home_pin": "600077", "home_state_word": "Kerala"},
    }])  # fmt: skip
    assert r.status_code == 200, r.text
    assert r.json() == {
        "received": 1, "saved": 1, "no_matching_candidate": 0,
        "processed": 1, "state_filled": 1, "gender_filled": 1, "skipped": 0, "errors": 0,
    }  # fmt: skip
    row = _stored(db_session, entry)
    assert (row.gender, row.gender_source, row.gender_confidence, row.gender_evidence) == ("Female", "resume_honorific", "medium", "Honorific 'Ms.'")
    assert (row.state, row.state_source, row.state_confidence, row.state_evidence) == ("Tamil Nadu", "resume_pincode", "high", "PIN code 600077")
    assert row.country == "India" and row.resume_hash == "h1" and row.inferred_at is not None
    # inference never touches the frozen original-reader copy
    assert (row.legacy_gender, row.legacy_state) == (None, None)


def test_clues_that_say_nothing_are_stored_so_the_file_is_not_read_again(client, db_session):
    entry = _selected_with_resume(db_session, "F1")
    r = _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": {}}])
    assert r.json()["processed"] == 1 and r.json()["state_filled"] == 0
    row = _stored(db_session, entry)
    assert (row.gender, row.state, row.country, row.resume_hash) == (None, None, None, "h1")


def test_an_unchanged_hash_is_skipped_and_a_changed_one_is_reprocessed(client, db_session):
    entry = _selected_with_resume(db_session, "F1")
    clues = {"home_state_word": "Goa"}
    _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": clues}])
    again = _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": {"home_state_word": "Kerala"}}]).json()
    assert (again["skipped"], again["processed"], again["saved"]) == (1, 0, 0)
    assert _stored(db_session, entry).state == "Goa"

    changed = _post_fields(client, [{"file_id": "F1", "resume_hash": "h2", "clues": {"home_state_word": "Kerala"}}]).json()
    assert (changed["skipped"], changed["processed"]) == (0, 1)
    assert _stored(db_session, entry).state == "Kerala"


def test_a_reading_that_finds_nothing_keeps_what_the_original_reader_found(client, db_session):
    entry = _selected_with_resume(db_session, "F1")
    _post_fields(client, [{"file_id": "F1", "gender": "Female", "state": "Kerala", "country": "India"}])
    _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": {}}])
    row = _stored(db_session, entry)
    assert (row.gender, row.state, row.state_source, row.resume_hash) == ("Female", "Kerala", "resume_address", "h1")


def test_the_hashes_endpoint_needs_the_secret_and_lists_read_files(client, db_session):
    url = "/api/v1/talent-pool/resume-fields/hashes"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-Talent-Pool-Sync-Secret": "wrong"}).status_code == 401
    _selected_with_resume(db_session, "F1")
    _selected_with_resume(db_session, "F2")
    _selected_with_resume(db_session, "F3", status="Rejected")
    _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": {}}, {"file_id": "F2", "state": "Goa"}])
    r = client.get(url, headers=HEADERS)
    assert r.status_code == 200 and r.json() == {"F1": "h1"}


def test_the_hashes_endpoint_is_closed_when_no_secret_is_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "TALENT_POOL_SYNC_SECRET", "")
    assert client.get("/api/v1/talent-pool/resume-fields/hashes", headers=HEADERS).status_code == 503


def test_a_sheet_value_is_never_overwritten_by_inference(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    entry = _selected_with_resume(db_session, "F1", State="Goa", Gender="Male")
    _post_fields(client, [{"file_id": "F1", "resume_hash": "h1", "clues": {"gender_field": "Female", "home_pin": "682001"}}])
    for flag in ("true", "false"):
        row = _row(client, admin, entry, include_inferred=flag)
        assert (row["gender"], row["state"]) == ("Male", "Goa")
        assert (row["gender_source"], row["state_source"]) == ("sheet", "sheet")
        assert row["gender_evidence"] is None and row["state_evidence"] is None
    db_session.expire_all()
    assert entry.raw == {"State": "Goa", "Gender": "Male"}


def test_include_inferred_false_reproduces_the_original_numbers(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    # Original reader: A has gender+state, B state only.
    a = _selected_with_resume(db_session, "A")
    b = _selected_with_resume(db_session, "B")
    c = _selected_with_resume(db_session, "C")
    d = _selected_with_resume(db_session, "D", Gender="Male")
    _post_fields(client, [
        {"file_id": "A", "gender": "Female", "state": "Kerala", "country": "India"},
        {"file_id": "B", "state": "Goa", "country": "India"},
    ])  # fmt: skip

    def counts(flag):
        body = _breakdown_params(client, admin, include_inferred=flag)
        return {k: (body[k]["recorded"], body[k]["from_sheet"], body[k]["inferred"]) for k in ("gender", "state", "country")}

    before_true, before_false = counts("true"), counts("false")
    assert before_true == before_false == {"gender": (2, 1, 1), "state": (2, 0, 2), "country": (2, 0, 2)}

    # New clue data arrives: inference fills C and D, re-reads A with a different answer.
    _post_fields(client, [
        {"file_id": "A", "resume_hash": "h", "clues": {"honorific": "Mr.", "home_pin": "400001"}},
        {"file_id": "C", "resume_hash": "h", "clues": {"honorific": "Mrs.", "home_pin": "600001"}},
        {"file_id": "D", "resume_hash": "h", "clues": {"home_pin": "500001"}},
    ])  # fmt: skip
    assert counts("false") == before_false
    after = counts("true")
    assert after["gender"] == (3, 1, 2) and after["state"] == (4, 0, 4)

    # The sheet-only rows are exactly the original reader's values.
    rows = {r["id"]: r for r in _rows(client, admin, include_inferred="false")}
    assert (rows[str(a.id)]["gender"], rows[str(a.id)]["state"]) == ("Female", "Kerala")
    assert (rows[str(a.id)]["gender_source"], rows[str(a.id)]["state_source"]) == ("resume_field", "resume_address")
    assert (rows[str(b.id)]["gender"], rows[str(b.id)]["state"]) == (None, "Goa")
    assert (rows[str(c.id)]["gender"], rows[str(c.id)]["state"]) == (None, None)
    assert rows[str(c.id)]["gender_source"] == rows[str(c.id)]["state_source"] == "unknown"
    assert rows[str(d.id)]["gender"] == "Male" and rows[str(d.id)]["state"] is None

    # And the default (no parameter) is the effective view, with provenance on each row.
    eff = {r["id"]: r for r in _rows(client, admin)}
    assert (eff[str(a.id)]["gender"], eff[str(a.id)]["state"]) == ("Male", "Maharashtra")
    assert eff[str(c.id)]["gender_source"] == "resume_honorific" and eff[str(c.id)]["gender_evidence"] == "Honorific 'Mrs.'"
    assert eff[str(c.id)]["state_source"] == "resume_pincode" and eff[str(c.id)]["state_evidence"] == "PIN code 600001"
    assert eff[str(d.id)]["gender_source"] == "sheet"
    assert _rows(client, admin) == _rows(client, admin, include_inferred="true")


def _breakdown_params(client, user, **params):
    r = client.get(
        "/api/v1/talent-pool/selected-breakdown",
        params={"source_tab": "TEACHING_FINAL", **params},
        headers=auth_headers(client, user),
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_register_filters_cross_filter_in_both_modes(client, db_session, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    for file_id in "ABC":
        _selected_with_resume(db_session, file_id)
    _post_fields(client, [
        {"file_id": "A", "gender": "Female", "state": "Kerala", "country": "India"},
        {"file_id": "B", "state": "Goa", "country": "India"},
    ])  # fmt: skip
    _post_fields(client, [{"file_id": "C", "resume_hash": "h", "clues": {"honorific": "Mr.", "home_pin": "600001"}}])

    def listed(**params):
        r = client.get(
            "/api/v1/talent-pool",
            params={"source_tab": "TEACHING_FINAL", "limit": 100, **params},
            headers=auth_headers(client, admin),
        )
        assert r.status_code == 200, r.text
        return r.json()["total"]

    assert listed(state=["Kerala", "Goa", "Tamil Nadu"]) == 3
    assert listed(state=["Kerala", "Goa", "Tamil Nadu"], include_inferred="false") == 2
    assert listed(state=["Tamil Nadu"], include_inferred="false") == 0
    assert listed(gender=["Female", "Male"]) == 2
    assert listed(gender=["Female", "Male"], include_inferred="false") == 1
    assert listed(state=["Kerala", "Goa"], gender="Female", include_inferred="false") == 1
