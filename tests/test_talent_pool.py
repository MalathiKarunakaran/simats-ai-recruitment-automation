"""Talent pool read API (2026-10-23), Step A of
docs/specs/talent-pool-dashboard.md.

The fixture below is deliberately hand-countable: 20 teaching rows and 10
NTS rows whose totals are written out as literals in the assertions rather
than recomputed from the fixture. A test that derives its expectation from
the same comprehension the fixture uses would pass even if the SQL counted
the wrong thing.

Two of the teaching rows spell CSE differently in `dept_raw` ("CSE" and
"Computer Science & Engg") while sharing `dept_group` "CSE". That pair is
what separates the Grouped and As-in-sheet modes, and it is the single most
important thing here: the whole point of keeping two department columns is
that a mis-grouping stays traceable to what the sheet said.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.audit_log import AuditLog
from app.models.enums import (
    TALENT_POOL_ELIGIBLE_VALUES,
    TALENT_POOL_SYNCED_ACTION,
    TalentPoolSourceTabEnum,
    UserRoleEnum,
)
from app.models.talent_pool_entry import TalentPoolEntry

from tests.conftest import auth_headers

TEACHING = "TEACHING_FINAL"
NTS = "NTS"


def _entry(db_session, **kw) -> TalentPoolEntry:
    defaults = {
        "source_tab": TalentPoolSourceTabEnum.TEACHING_FINAL,
        "full_name": f"Candidate {uuid.uuid4().hex[:6]}",
        "sheet_status": "Pending",
        "is_active": True,
        "raw": {},
    }
    defaults.update(kw)
    entry = TalentPoolEntry(**defaults)
    db_session.add(entry)
    db_session.flush()
    return entry


@pytest.fixture()
def pool(db_session):
    """20 teaching + 10 NTS rows, 2 of them inactive (1 per tab).

    Teaching active (19):
      status      Selected 4, Waiting List 3, Rejected 5, Pending 7
      eligibility With Ph.D 9, Thesis / viva stage 1, Pursuing Ph.D 3,
                  No Ph.D 2, Not eligible 2, blank 2 (one NULL, one "")
      dept_group  CSE 7 (2 raw spellings), ECE 5, Nursing 4, blank 3
      dept_raw    CSE 6, Computer Science & Engg 1, ECE 5, Nursing 4, blank 3
      source      Mam Data 6 + "mam data" 1, Our Data 7, blank 5
      applied_on  17 dated inside the last 3 months, 2 with no date
    NTS active (9):
      status      Selected 2, Rejected 1, RNR 2, On Hold 1,
                  Interview Scheduled 1, Not Interested 1, No outcome 1
    """
    today = date.today()
    recent = today.replace(day=1)  # safely inside the current month

    rows = []

    def add(**kw):
        rows.append(_entry(db_session, **kw))

    # --- teaching: Selected (4) ---
    add(sheet_status="Selected", eligibility="With Ph.D", dept_raw="CSE",
        dept_group="CSE", applied_on=recent, source="Mam Data", called_by="Narmada")
    add(sheet_status="Selected", eligibility="With Ph.D",
        dept_raw="Computer Science & Engg", dept_group="CSE", applied_on=recent,
        source="mam data", called_by="Narmada")
    add(sheet_status="Selected", eligibility="With Ph.D", dept_raw="ECE",
        dept_group="ECE", applied_on=recent, source="Our Data", called_by="Suresh")
    add(sheet_status="Selected", eligibility="No Ph.D", dept_raw="Nursing",
        dept_group="Nursing", applied_on=recent, source="Our Data")

    # --- teaching: Waiting List (3) ---
    for raw, group in (("CSE", "CSE"), ("ECE", "ECE"), ("Nursing", "Nursing")):
        add(sheet_status="Waiting List", eligibility="With Ph.D", dept_raw=raw,
            dept_group=group, applied_on=recent, source="Mam Data")

    # --- teaching: Rejected (5) ---
    for raw, group, elig in (
        ("CSE", "CSE", "Pursuing Ph.D"),
        ("CSE", "CSE", "Pursuing Ph.D"),
        ("ECE", "ECE", "Not eligible"),
        ("ECE", "ECE", "Not eligible"),
        ("Nursing", "Nursing", "No Ph.D"),
    ):
        add(sheet_status="Rejected", eligibility=elig, dept_raw=raw,
            dept_group=group, applied_on=recent, source="Our Data")

    # --- teaching: Pending (7), incl. the 2 undated and the 2 blank-dept ---
    add(sheet_status="Pending", eligibility="With Ph.D", dept_raw="CSE",
        dept_group="CSE", applied_on=recent, source="Mam Data")
    add(sheet_status="Pending", eligibility="With Ph.D", dept_raw="CSE",
        dept_group="CSE", applied_on=recent - timedelta(days=40), source="Mam Data")
    add(sheet_status="Pending", eligibility="With Ph.D", dept_raw="ECE",
        dept_group="ECE", applied_on=recent - timedelta(days=70))
    add(sheet_status="Pending", eligibility="Thesis / viva stage",
        dept_raw="Nursing", dept_group="Nursing", applied_on=recent)
    # Empty-string eligibility AND empty-string department: the pair with
    # the NULL row below is what proves a blank cell and a missing cell end
    # up in the same bucket.
    add(sheet_status="Pending", eligibility="", dept_raw="",
        dept_group="", applied_on=recent)
    # The two undated rows -- excluded from `monthly`, counted in `undated`.
    add(sheet_status="Pending", eligibility="Pursuing Ph.D", dept_raw=None,
        dept_group=None, applied_on=None)
    add(sheet_status="Pending", eligibility=None, dept_raw=None,
        dept_group=None, applied_on=None)

    # --- teaching: one INACTIVE row (removed from the sheet) ---
    add(sheet_status="Selected", eligibility="With Ph.D", dept_raw="CSE",
        dept_group="CSE", applied_on=recent, is_active=False)

    # --- NTS: 9 active + 1 inactive ---
    nts = TalentPoolSourceTabEnum.NTS
    for st, post in (
        ("Selected", "Lab Assistant"),
        ("Selected", "lab assistant"),
        ("Rejected", "Office Assistant"),
        ("RNR", "Lab Assistant"),
        ("RNR", "Office Assistant"),
        ("On Hold", "Technician"),
        ("Interview Scheduled", "Technician"),
        ("Not Interested", "Office Assistant"),
        ("No outcome", "Driver"),
    ):
        add(source_tab=nts, sheet_status=st, applied_post=post,
            dept_raw="Administration", dept_group="Administration",
            applied_on=recent, source="Referral")
    add(source_tab=nts, sheet_status="Selected", applied_post="Driver",
        dept_raw="Administration", dept_group="Administration",
        applied_on=recent, is_active=False)

    db_session.commit()
    return rows


@pytest.fixture()
def admin_headers(client, user_factory):
    return auth_headers(client, user_factory(UserRoleEnum.HR_ADMIN))


def _summary(client, headers, tab=TEACHING, **params):
    response = client.get(
        "/api/v1/talent-pool/summary",
        params={"source_tab": tab, **params},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _list(client, headers, tab=TEACHING, **params):
    response = client.get(
        "/api/v1/talent-pool", params={"source_tab": tab, **params}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- access ------------------------------------------------------------------


def test_anonymous_gets_401_on_every_route(client, pool):
    entry_id = pool[0].id
    for path, params in (
        ("/api/v1/talent-pool/summary", {"source_tab": TEACHING}),
        ("/api/v1/talent-pool", {"source_tab": TEACHING}),
        (f"/api/v1/talent-pool/{entry_id}", {}),
    ):
        assert client.get(path, params=params).status_code == 401, path


@pytest.mark.parametrize(
    "role",
    [
        UserRoleEnum.RECRUITMENT_COORDINATOR,
        UserRoleEnum.RECRUITMENT_OFFICER,
        UserRoleEnum.CAMPUS_HOD,
        UserRoleEnum.MANAGEMENT,
        UserRoleEnum.INTERVIEW_PANEL_MEMBER,
    ],
)
def test_only_hr_admin_and_super_admin_can_read(client, user_factory, pool, role):
    """MANAGEMENT is in the list deliberately: it sees every campus
    elsewhere in this app, but the pool is unreviewed sheet data rather than
    a reporting surface, and the spec gates it to the two admin roles."""
    headers = auth_headers(client, user_factory(role, campus_code="SSE"))
    entry_id = pool[0].id
    for path, params in (
        ("/api/v1/talent-pool/summary", {"source_tab": TEACHING}),
        ("/api/v1/talent-pool", {"source_tab": TEACHING}),
        (f"/api/v1/talent-pool/{entry_id}", {}),
    ):
        assert client.get(path, params=params, headers=headers).status_code == 403, path


def test_super_admin_can_read_too(client, user_factory, pool):
    headers = auth_headers(client, user_factory(UserRoleEnum.SUPER_ADMIN))
    assert _summary(client, headers)["total"] == 19


def test_source_tab_is_required_and_validated(client, admin_headers):
    assert client.get("/api/v1/talent-pool/summary", headers=admin_headers).status_code == 422
    response = client.get(
        "/api/v1/talent-pool/summary",
        params={"source_tab": "SOMETHING_ELSE"},
        headers=admin_headers,
    )
    assert response.status_code == 422


# --- summary -----------------------------------------------------------------


def test_teaching_totals_match_hand_counted_fixture(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    assert data["source_tab"] == TEACHING
    assert data["total"] == 19
    assert data["by_status"] == {
        "Selected": 4,
        "Waiting List": 3,
        "Rejected": 5,
        "Pending": 7,
    }


def test_teaching_eligibility_counts_bucket_blanks_as_not_set(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    assert data["by_eligibility"] == {
        "With Ph.D": 9,
        "Thesis / viva stage": 1,
        "Pursuing Ph.D": 3,
        "No Ph.D": 2,
        "Not eligible": 2,
        "Not set": 2,
    }
    # Both a NULL and an empty string land in the same bucket -- a blank
    # cell and a missing cell mean the same thing to a reader.
    assert sum(data["by_eligibility"].values()) == data["total"]


def test_eligible_definition_matches_the_constant(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    assert data["eligible_definition"] == list(TALENT_POOL_ELIGIBLE_VALUES)
    # Thesis/viva is deliberately NOT eligible; the tile reports it apart.
    assert "Thesis / viva stage" not in data["eligible_definition"]


def test_eligible_pending_is_with_phd_and_undecided_only(client, admin_headers, pool):
    """Of the 9 With Ph.D rows, 3 are Pending -- the other 6 are Selected
    (3) or Waiting List (3). The tile counts the intersection, so a
    qualified candidate nobody has decided on yet is the one it surfaces."""
    data = _summary(client, admin_headers)
    assert data["eligible_pending"] == 3


def test_monthly_always_has_twelve_points_oldest_first(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    months = data["monthly"]
    assert len(months) == 12
    assert months == sorted(months, key=lambda m: m["month"])
    # The current month is last, and empty months are zeros rather than gaps.
    assert months[-1]["month"] == date.today().strftime("%Y-%m")
    assert all(isinstance(m["added"], int) for m in months)


def test_monthly_counts_exclude_undated_rows_and_undated_reports_them(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    assert data["undated"] == 2
    # 19 active teaching rows, 2 with no date -> the bars must sum to 17.
    assert sum(m["added"] for m in data["monthly"]) == 17
    assert sum(m["selected"] for m in data["monthly"]) == 4


def test_department_group_mode_merges_the_two_cse_spellings(client, admin_headers, pool):
    data = _summary(client, admin_headers, dept_mode="group")
    assert data["department_mode"] == "group"
    by_dept = {r["department"]: r for r in data["by_department"]}
    assert by_dept["CSE"]["total"] == 7
    assert by_dept["ECE"]["total"] == 5
    assert by_dept["Nursing"]["total"] == 4
    assert by_dept["Not set"]["total"] == 3
    assert data["department_count"] == 4
    # Sorted by total, descending (spec 1.4).
    totals = [r["total"] for r in data["by_department"]]
    assert totals == sorted(totals, reverse=True)


def test_department_raw_mode_keeps_them_apart(client, admin_headers, pool):
    data = _summary(client, admin_headers, dept_mode="raw")
    assert data["department_mode"] == "raw"
    by_dept = {r["department"]: r["total"] for r in data["by_department"]}
    assert by_dept["CSE"] == 6
    assert by_dept["Computer Science & Engg"] == 1
    # One more department than Grouped, for the same 19 rows.
    assert data["department_count"] == 5
    assert sum(by_dept.values()) == 19


def test_department_columns_add_up_and_open_catches_the_undecided(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    for row in data["by_department"]:
        assert row["selected"] + row["waiting"] + row["rejected"] + row["open"] == row["total"]
    by_dept = {r["department"]: r for r in data["by_department"]}
    # CSE: 2 Selected, 1 Waiting, 2 Rejected, 2 Pending
    assert by_dept["CSE"]["selected"] == 2
    assert by_dept["CSE"]["open"] == 2
    assert by_dept["CSE"]["eligible"] == 5


def test_nts_ignores_dept_mode_because_it_has_no_toggle(client, admin_headers, pool):
    """Spec 1.4: NTS's dept_group is just the trimmed name, so honouring
    dept_mode there would offer a choice between two identical tables."""
    raw = _summary(client, admin_headers, tab=NTS, dept_mode="raw")
    assert raw["department_mode"] == "group"
    assert [r["department"] for r in raw["by_department"]] == ["Administration"]


def test_nts_totals_and_call_outcomes(client, admin_headers, pool):
    data = _summary(client, admin_headers, tab=NTS)
    assert data["total"] == 9
    assert data["by_status"] == {
        "Selected": 2,
        "Rejected": 1,
        "RNR": 2,
        "On Hold": 1,
        "Interview Scheduled": 1,
        "Not Interested": 1,
        "No outcome": 1,
    }
    outcomes = {i["label"]: i["count"] for i in data["breakdowns"]["call_outcomes"]}
    assert outcomes == {
        "Interview Scheduled": 1,
        "On Hold": 1,
        "RNR": 2,
        "Not Interested": 1,
        "No outcome": 1,
    }
    # NTS has no PhD question, so these stay empty rather than zero-filled.
    assert data["by_eligibility"] == {}
    assert data["eligible_pending"] == 0


def test_nts_applied_post_merges_case_insensitively(client, admin_headers, pool):
    data = _summary(client, admin_headers, tab=NTS)
    posts = {i["label"]: i["count"] for i in data["breakdowns"]["applied_post"]}
    # "Lab Assistant" and "lab assistant" are one bucket, labelled with the
    # more frequent spelling.
    assert posts["Lab Assistant"] == 3
    assert "lab assistant" not in posts


def test_source_breakdown_merges_case_insensitively(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    sources = {i["label"]: i["count"] for i in data["breakdowns"]["source"]}
    # "Mam Data" x6 and "mam data" x1 -> one entry of 7 under the majority
    # spelling.
    assert sources["Mam Data"] == 7
    assert "mam data" not in sources


def test_called_by_breakdown_skips_blanks(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    labels = {i["label"] for i in data["breakdowns"]["called_by"]}
    assert labels == {"Narmada", "Suresh"}
    assert "Not set" not in labels


def test_eligibility_breakdown_keeps_its_fixed_order(client, admin_headers, pool):
    data = _summary(client, admin_headers)
    labels = [i["label"] for i in data["breakdowns"]["eligibility"]]
    assert labels == [
        "With Ph.D",
        "Thesis / viva stage",
        "Pursuing Ph.D",
        "No Ph.D",
        "Not eligible",
        "Not set",
    ]


def test_an_unexpected_status_is_shown_not_dropped(client, admin_headers, pool, db_session):
    """The whole reason sheet_status is a plain string: a spelling nobody
    anticipated has to be visible so somebody can go and fix the sheet."""
    _entry(db_session, sheet_status="Shortlisted?", dept_raw="CSE", dept_group="CSE")
    db_session.commit()
    data = _summary(client, admin_headers)
    assert data["by_status"]["Shortlisted?"] == 1
    assert data["total"] == 20
    # It is undecided, so it lands in `open` and the columns still add up.
    by_dept = {r["department"]: r for r in data["by_department"]}
    assert by_dept["CSE"]["open"] == 3


# --- include_inactive --------------------------------------------------------


def test_include_inactive_changes_totals_by_exactly_the_inactive_count(
    client, admin_headers, pool
):
    active = _summary(client, admin_headers)
    everything = _summary(client, admin_headers, include_inactive=True)
    assert active["total"] == 19
    assert everything["total"] == 20
    assert everything["by_status"]["Selected"] == active["by_status"]["Selected"] + 1

    nts_active = _summary(client, admin_headers, tab=NTS)
    nts_all = _summary(client, admin_headers, tab=NTS, include_inactive=True)
    assert nts_all["total"] == nts_active["total"] + 1


def test_the_register_hides_removed_rows_by_default(client, admin_headers, pool):
    assert _list(client, admin_headers, limit=100)["total"] == 19
    assert _list(client, admin_headers, limit=100, include_inactive=True)["total"] == 20


# --- list / register ---------------------------------------------------------


def test_list_returns_the_repos_paginated_envelope(client, admin_headers, pool):
    data = _list(client, admin_headers)
    assert set(data) == {"items", "total", "limit", "offset"}
    assert data["total"] == 19
    assert data["limit"] == 25
    assert data["offset"] == 0


def test_list_omits_raw_and_content_hash(client, admin_headers, pool):
    item = _list(client, admin_headers)["items"][0]
    assert "raw" not in item
    assert "content_hash" not in item
    assert "full_name" in item and "dept_group" in item


def test_pagination_limits_hold(client, admin_headers, pool):
    page = _list(client, admin_headers, limit=5)
    assert len(page["items"]) == 5
    assert page["total"] == 19

    second = _list(client, admin_headers, limit=5, offset=5)
    assert len(second["items"]) == 5
    first_ids = {i["id"] for i in page["items"]}
    assert first_ids.isdisjoint({i["id"] for i in second["items"]})

    assert client.get(
        "/api/v1/talent-pool",
        params={"source_tab": TEACHING, "limit": 101},
        headers=admin_headers,
    ).status_code == 422


def test_paging_the_whole_register_yields_every_row_exactly_once(client, admin_headers, pool):
    """The ordering must be TOTAL, not merely sensible.

    Two rows comparing equal on every sort key leave Postgres free to
    return them in any order, and then OFFSET paging repeats one row on
    two pages and never shows another. Ties are the normal case here: a
    sync writes every row in one transaction so they share a `created_at`,
    and candidates routinely share an applied date -- this fixture has 19
    rows, one `created_at` and three distinct dates.

    Comparing page 1 with page 2 is not enough to catch it (the original
    test did exactly that and passed). Walk the whole register.
    """
    seen: list[str] = []
    for offset in range(0, 20, 4):
        seen.extend(item["id"] for item in _list(client, admin_headers, limit=4, offset=offset)["items"])

    everything = _list(client, admin_headers, limit=100)["items"]
    assert len(seen) == len(everything) == 19
    # No repeats, and nothing missed.
    assert len(set(seen)) == 19
    assert set(seen) == {item["id"] for item in everything}


def test_the_same_page_twice_is_the_same_page(client, admin_headers, pool):
    """A stable order also means a page does not reshuffle between requests
    -- otherwise clicking Next and then Previous shows different people."""
    first = [i["id"] for i in _list(client, admin_headers, limit=5)["items"]]
    again = [i["id"] for i in _list(client, admin_headers, limit=5)["items"]]
    assert first == again


def test_undated_rows_sort_last(client, admin_headers, pool):
    items = _list(client, admin_headers, limit=100)["items"]
    dates = [i["applied_on"] for i in items]
    assert dates[-1] is None and dates[-2] is None
    assert all(d is not None for d in dates[:-2])


def test_filters_combine(client, admin_headers, pool):
    data = _list(
        client,
        admin_headers,
        sheet_status="Rejected",
        department="CSE",
        eligibility="Pursuing Ph.D",
        limit=100,
    )
    assert data["total"] == 2
    assert all(i["sheet_status"] == "Rejected" for i in data["items"])
    assert all(i["dept_group"] == "CSE" for i in data["items"])


def test_department_filter_follows_dept_mode(client, admin_headers, pool):
    """A department row click has to filter to exactly that row's count, so
    the filter must read the same column the table was grouped by."""
    grouped = _list(client, admin_headers, department="CSE", dept_mode="group", limit=100)
    assert grouped["total"] == 7

    raw = _list(client, admin_headers, department="CSE", dept_mode="raw", limit=100)
    assert raw["total"] == 6

    spelling = _list(
        client, admin_headers, department="Computer Science & Engg", dept_mode="raw", limit=100
    )
    assert spelling["total"] == 1


def test_not_set_department_filter_matches_blanks(client, admin_headers, pool):
    """"Not set" is the label the summary gives a blank department, so
    clicking that row must return those rows and not nothing."""
    data = _list(client, admin_headers, department="Not set", limit=100)
    assert data["total"] == 3
    assert all(not i["dept_group"] for i in data["items"])


def test_search_covers_the_spec_columns(client, admin_headers, pool, db_session):
    _entry(
        db_session,
        full_name="Meenakshi Sundaram",
        email="meena@example.com",
        phone="9876500000",
        dept_raw="Biotechnology",
        dept_group="Biotechnology",
        remarks="asked to call back after Pongal",
    )
    db_session.commit()
    for term in ("Meenakshi", "meena@example", "9876500000", "Biotech", "Pongal"):
        assert _list(client, admin_headers, q=term, limit=100)["total"] == 1, term


def test_a_percent_in_the_search_is_literal(client, admin_headers, pool, db_session):
    """Without escaping, "%" matches every row -- which reads as a broken
    filter rather than as a wildcard the user did not know they typed."""
    _entry(db_session, full_name="Ravi 100% Attendance", dept_group="CSE")
    db_session.commit()
    assert _list(client, admin_headers, q="100%", limit=100)["total"] == 1
    # A bare "%" finds the one row that literally contains a percent sign --
    # NOT all 20, which is what an unescaped wildcard would have returned.
    assert _list(client, admin_headers, q="%", limit=100)["total"] == 1
    # No row contains an underscore, so the other wildcard finds nothing.
    assert _list(client, admin_headers, q="_", limit=100)["total"] == 0


def test_the_two_tabs_do_not_leak_into_each_other(client, admin_headers, pool):
    teaching = _list(client, admin_headers, limit=100)
    nts = _list(client, admin_headers, tab=NTS, limit=100)
    assert all(i["source_tab"] == TEACHING for i in teaching["items"])
    assert all(i["source_tab"] == NTS for i in nts["items"])


# --- single entry ------------------------------------------------------------


def test_one_entry_comes_back_with_every_sheet_column(client, admin_headers, db_session):
    entry = _entry(
        db_session,
        full_name="Anitha R",
        dept_raw="CSE",
        dept_group="CSE",
        raw={"Actual Dept": "CSE", "Applied Date": "14-10-2026", "Remarks": "called"},
    )
    db_session.commit()
    response = client.get(f"/api/v1/talent-pool/{entry.id}", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["full_name"] == "Anitha R"
    # `raw` is the one place every sheet column is rendered, so a column
    # nobody modelled is still visible to a human.
    assert data["raw"]["Applied Date"] == "14-10-2026"


def test_a_missing_entry_is_404(client, admin_headers):
    response = client.get(f"/api/v1/talent-pool/{uuid.uuid4()}", headers=admin_headers)
    assert response.status_code == 404


# --- freshness ---------------------------------------------------------------


def test_freshness_is_null_until_a_sync_has_run(client, admin_headers, pool):
    """A real state, not an error: the read side was built first, so a
    database can legitimately hold entries and no sync history. The
    frontend must read None as "never synced"."""
    data = _summary(client, admin_headers)
    assert data["last_sync_at"] is None
    assert data["sheet_last_update"] is None
    assert data["last_sync_counts"] is None


def test_freshness_comes_from_the_latest_sync_audit_row(client, admin_headers, pool, db_session):
    older = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
    newer = datetime(2026, 10, 21, 17, 0, tzinfo=timezone.utc)
    for when, sheet_stamp in ((older, "13-10-2026, 09.00 am"), (newer, "14-10-2026, 04.51 pm")):
        db_session.add(
            AuditLog(
                action=TALENT_POOL_SYNCED_ACTION,
                entity_type="TalentPoolEntry",
                after_state={
                    "sheet_last_update": sheet_stamp,
                    "counts": {"inserted": 12, "updated": 30, "unchanged": 7700, "deactivated": 0},
                },
                created_at=when,
            )
        )
    db_session.commit()

    data = _summary(client, admin_headers)
    assert data["sheet_last_update"] == "14-10-2026, 04.51 pm"
    assert data["last_sync_counts"]["inserted"] == 12
    assert data["last_sync_at"].startswith("2026-10-21")
