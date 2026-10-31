"""Joining records read API (docs/specs/joining-screens.md).

Hand-countable fixtures, with the expected numbers written as literals: a
test that recomputed its expectation from the fixture would pass even if
the SQL counted the wrong thing. On top of that, every count a summary
returns is checked against the list filter that count opens -- the spec's
rule, same as the Talent Pool's.

Probation buckets are relative to `date.today()`; the fixture builds its
dates from the same call, so the tests hold on any day.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.enums import GLOBAL_SCOPE_ROLES, TalentPoolSourceTabEnum, UserRoleEnum
from app.models.sheet_sync import (
    DepartmentFaculty,
    NewDepartment,
    ProvisionalOrder,
    SheetJoinee,
    SheetSyncRun,
)
from app.models.talent_pool_entry import TalentPoolEntry

from tests.conftest import auth_headers

BASE = "/api/v1/joining-records"


def _add(db_session, obj):
    db_session.add(obj)
    db_session.flush()
    return obj


def _months_back(today: date, n: int) -> date:
    y, m = today.year, today.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


@pytest.fixture()
def data(db_session):
    """
    Joinees, active (6) + 1 inactive:
      category    TEACHING 3 (A,B,F), NON_TEACHING 1 (C), HOUSEKEEPING 1 (D), none 1 (E)
      state       ACTIVE 3 (A,C,F), LEFT 1 (B), REJOINED 1 (D), none 1 (E)
      campus      SSE 3 (A,B,E), SCLAS 2 (C,F), none 1 (D)
      joined      this month 3 (A,B,F), last month 1 (C), undated 2 (D,E)
      linked TP   2 (A,F)
      flagged     rows 3 and 5 in the latest real run -> B, D (2); the
                  inactive G also sits on row 3 and must not count
    Orders, active (7) + 1 inactive:
      status      ISSUED 5, PENDING 1, none 1
      outcome     PERMANENT 1, EXTENDED 1, NOT_RECOMMENDED 1, none 4
      due30 3 (O1 +10d, O2 +30d boundary, O7 today), overdue 1 (O4),
      ended 2 (O4, O5), unlinked 6 (all but O1)
    Departments: Robotics (3 + 1), Data Science (2 + none), Old Dept inactive.
      Robotics members 4: HOD f1, additional f2, LEFT f3, ON_LEAVE f4
        -> active 3, active_additional 1, left 1, on_leave 1, gap 4 - 3 = 1
      Data Science members 2: HOD f5 LEFT, f6 -> active 1, left 1, gap 1, no HOD
      unmatched: "Additive Manufacuring Engineering" 2 (one with a trailing
        space), "Not set" 1, "Old Dept" 1 (linked to the inactive department)
      faculty_total 10 (f11 inactive)
    """
    today = date.today()
    this_month = today.replace(day=1)
    last_month = _months_back(today, 1)

    tp = _add(
        db_session,
        TalentPoolEntry(
            source_tab=TalentPoolSourceTabEnum.TEACHING_FINAL,
            full_name="Anitha Pool",
            sheet_status="Selected",
            is_active=True,
            raw={},
        ),
    )

    def joinee(name, row, **kw):
        defaults = dict(row_key=uuid.uuid4().hex, full_name=name, sheet_row_number=row, is_active=True, raw={})
        defaults.update(kw)
        return _add(db_session, SheetJoinee(**defaults))

    a = joinee("Anitha R", 2, bio_id="B100", category="TEACHING", employment_state="ACTIVE", campus_code="SSE",
               joined_on=this_month, talent_pool_entry_id=tp.id, designation="Assistant Professor",
               raw={"Name": "Anitha R", "Designation": "Assistant Professor"})
    joinee("Bala K", 3, bio_id="B101", category="TEACHING", employment_state="LEFT", campus_code="SSE",
           joined_on=this_month)
    joinee("Chitra M", 4, bio_id="B102", category="NON_TEACHING", employment_state="ACTIVE", campus_code="SCLAS",
           joined_on=last_month, department_raw="Library")
    joinee("Dinesh P", 5, bio_id="B103", category="HOUSEKEEPING", employment_state="REJOINED", campus_code=None)
    joinee("Elango S", 6, bio_id="B104", employee_type_raw="JRF", category=None, employment_state=None,
           campus_code="SSE")
    joinee("Fathima N", 7, bio_id="B105", category="TEACHING", employment_state="ACTIVE", campus_code="SCLAS",
           joined_on=this_month, talent_pool_entry_id=tp.id)
    joinee("Gone G", 3, bio_id="B106", category="TEACHING", employment_state="ACTIVE", campus_code="SSE",
           joined_on=this_month, is_active=False)

    now = datetime.now(timezone.utc)
    # An older real run, the latest real run, and a NEWER dry run: only the
    # latest real run's flags count.
    db_session.add(SheetSyncRun(source="NEW_JOINEES", dry_run=False, counts={},
                                flagged=[{"row_number": 2, "key": "B100", "reason": "old"}],
                                created_at=now - timedelta(hours=2)))
    db_session.add(SheetSyncRun(source="NEW_JOINEES", dry_run=False, counts={},
                                flagged=[{"row_number": 3, "key": "B101", "reason": "x"},
                                         {"row_number": 5, "key": "B103", "reason": "y"},
                                         {"row_number": 5, "key": "B103", "reason": "z"},
                                         {"row_number": 99, "key": None, "reason": "no key"}],
                                created_at=now - timedelta(hours=1)))
    db_session.add(SheetSyncRun(source="NEW_JOINEES", dry_run=True, counts={},
                                flagged=[{"row_number": 4, "key": "B102", "reason": "dry"}],
                                created_at=now))

    def order(bio, **kw):
        defaults = dict(row_key=uuid.uuid4().hex, bio_id=bio, full_name=f"Person {bio}", is_active=True, raw={})
        defaults.update(kw)
        return _add(db_session, ProvisionalOrder(**defaults))

    order("O1", order_status="ISSUED", probation_end_on=today + timedelta(days=10), sheet_joinee_id=a.id,
          order_on=today - timedelta(days=170), id_card="Yes", room_allotted="A-101")
    order("O2", order_status="ISSUED", probation_end_on=today + timedelta(days=30),
          outcome="PERMANENT_ORDER_RECEIVED")
    order("O3", order_status="ISSUED", probation_end_on=today + timedelta(days=31))
    order("O4", order_status="ISSUED", probation_end_on=today - timedelta(days=1))
    order("O5", order_status="ISSUED", probation_end_on=today - timedelta(days=20), outcome="PROBATION_EXTENDED")
    order("O6", order_status="PENDING")
    order("O7", order_status=None, probation_end_on=today, outcome="NOT_RECOMMENDED")
    order("O8", order_status="ISSUED", probation_end_on=today - timedelta(days=5), is_active=False)

    def dept(name, count, additional, active=True):
        return _add(db_session, NewDepartment(row_key=uuid.uuid4().hex, name=name, count=count,
                                              additional_count=additional, is_active=active, raw={}))

    robotics = dept("Robotics", 3, 1)
    data_science = dept("Data Science", 2, None)
    old = dept("Old Dept", 5, 0, active=False)

    def fac(bio, **kw):
        defaults = dict(row_key=uuid.uuid4().hex, bio_id=bio, full_name=f"Faculty {bio}", is_active=True, raw={})
        defaults.update(kw)
        return _add(db_session, DepartmentFaculty(**defaults))

    fac("F1", dept_raw="Robotics", new_department_id=robotics.id, role="HOD", sheet_joinee_id=a.id,
        full_name="Dr Robo Head")
    fac("F2", dept_raw="Robotics", new_department_id=robotics.id, role="MEMBER", is_additional=True)
    fac("F3", dept_raw="Robotics", new_department_id=robotics.id, role="MEMBER", employment_state="LEFT")
    fac("F4", dept_raw="robotics", new_department_id=robotics.id, role="MEMBER", employment_state="ON_LEAVE")
    fac("F5", dept_raw="Data Science", new_department_id=data_science.id, role="HOD", employment_state="LEFT")
    fac("F6", dept_raw="Data Science", new_department_id=data_science.id, role="MEMBER")
    fac("F7", dept_raw="Additive Manufacuring Engineering", role="MEMBER")
    fac("F8", dept_raw="Additive Manufacuring Engineering ", role=None)
    fac("F9", dept_raw=None, role="MEMBER")
    fac("F10", dept_raw="Old Dept", new_department_id=old.id, role="MEMBER")
    fac("F11", dept_raw="Robotics", new_department_id=robotics.id, role="MEMBER", is_active=False)

    db_session.commit()
    return {"a": a, "tp": tp, "robotics": robotics}


@pytest.fixture()
def admin_headers(client, user_factory):
    return auth_headers(client, user_factory(UserRoleEnum.HR_ADMIN))


def _get(client, headers, path, **params):
    response = client.get(f"{BASE}{path}", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _total(client, headers, path, **params):
    return _get(client, headers, path, limit=100, **params)["total"]


# --- access ------------------------------------------------------------------

_PATHS = (
    "/joinees/summary",
    "/joinees",
    "/orders/summary",
    "/orders",
    "/departments",
    "/faculty",
)


def test_anonymous_gets_401(client, data):
    for path in (*_PATHS, f"/joinees/{data['a'].id}"):
        assert client.get(f"{BASE}{path}").status_code == 401, path


@pytest.mark.parametrize(
    "role",
    [
        UserRoleEnum.RECRUITMENT_OFFICER,
        UserRoleEnum.CAMPUS_HOD,
        UserRoleEnum.MANAGEMENT,
        UserRoleEnum.INTERVIEW_PANEL_MEMBER,
    ],
)
def test_other_roles_get_403(client, user_factory, data, role):
    headers = auth_headers(client, user_factory(role, campus_code="SSE"))
    for path in (*_PATHS, f"/joinees/{data['a'].id}"):
        assert client.get(f"{BASE}{path}", headers=headers).status_code == 403, path


@pytest.mark.parametrize(
    "role", [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR]
)
def test_the_three_readers_can_read_everything(client, user_factory, data, role):
    headers = auth_headers(client, user_factory(role, campus_code="SSE"))
    for path in (*_PATHS, f"/joinees/{data['a'].id}"):
        assert client.get(f"{BASE}{path}", headers=headers).status_code == 200, path


def test_every_reader_role_sees_all_campuses():
    """No campus scoping is applied, so a single-campus reader would leak."""
    from app.api.v1.routers.joining_records import _READERS

    assert set(_READERS) <= set(GLOBAL_SCOPE_ROLES)


# --- joinees -----------------------------------------------------------------


def test_joinee_summary_hand_counted(client, admin_headers, data):
    s = _get(client, admin_headers, "/joinees/summary")
    assert s["total"] == 6
    assert s["by_category"] == {"TEACHING": 3, "NON_TEACHING": 1, "HOUSEKEEPING": 1, "none": 1}
    assert s["by_employment_state"] == {"ACTIVE": 3, "LEFT": 1, "REJOINED": 1, "none": 1}
    assert s["by_campus"] == [
        {"value": "SSE", "count": 3},
        {"value": "SCLAS", "count": 2},
        {"value": "none", "count": 1},
    ]
    assert s["undated"] == 2
    assert s["flagged"] == 2
    assert s["linked_talent_pool"] == 2
    assert len(s["monthly"]) == 12
    assert s["monthly"][-1]["count"] == 3
    assert s["monthly"][-2]["count"] == 1
    assert s["last_sync_at"] is not None


def test_every_joinee_count_equals_its_list(client, admin_headers, data):
    s = _get(client, admin_headers, "/joinees/summary")
    assert _total(client, admin_headers, "/joinees") == s["total"]
    for key, n in s["by_category"].items():
        assert _total(client, admin_headers, "/joinees", category=key) == n, key
    for key, n in s["by_employment_state"].items():
        assert _total(client, admin_headers, "/joinees", employment_state=key) == n, key
    for item in s["by_campus"]:
        assert _total(client, admin_headers, "/joinees", campus_code=item["value"]) == item["count"], item
    for point in s["monthly"]:
        assert _total(client, admin_headers, "/joinees", joined_month=point["month"]) == point["count"], point
    assert _total(client, admin_headers, "/joinees", joined_month="undated") == s["undated"]
    assert _total(client, admin_headers, "/joinees", flagged=True) == s["flagged"]
    assert _total(client, admin_headers, "/joinees", linked_talent_pool=True) == s["linked_talent_pool"]


def test_counts_equal_lists_with_removed_rows_too(client, admin_headers, data):
    s = _get(client, admin_headers, "/joinees/summary", include_inactive=True)
    assert s["total"] == 7
    for key, n in s["by_category"].items():
        assert _total(client, admin_headers, "/joinees", category=key, include_inactive=True) == n, key
    # The inactive row shares a flagged row number but is never "flagged".
    assert s["flagged"] == 2
    assert _total(client, admin_headers, "/joinees", flagged=True, include_inactive=True) == 2


def test_removed_joinees_are_hidden_by_default(client, admin_headers, data):
    names = {r["full_name"] for r in _get(client, admin_headers, "/joinees", limit=100)["items"]}
    assert "Gone G" not in names
    names = {r["full_name"] for r in _get(client, admin_headers, "/joinees", limit=100, include_inactive=True)["items"]}
    assert "Gone G" in names


def test_flagged_is_empty_without_a_real_run(client, admin_headers, db_session, data):
    db_session.query(SheetSyncRun).filter(SheetSyncRun.dry_run.is_(False)).delete()
    db_session.commit()
    assert _get(client, admin_headers, "/joinees/summary")["flagged"] == 0
    assert _total(client, admin_headers, "/joinees", flagged=True) == 0


def test_joinee_search_and_filters_combine(client, admin_headers, data):
    assert _total(client, admin_headers, "/joinees", q="b102") == 1
    assert _total(client, admin_headers, "/joinees", q="library") == 1
    assert _total(client, admin_headers, "/joinees", q="assistant prof") == 1
    assert _total(client, admin_headers, "/joinees", category="TEACHING", campus_code="SSE") == 2
    assert _total(client, admin_headers, "/joinees", q="100%") == 0


def test_joinee_month_must_be_a_month(client, admin_headers, data):
    response = client.get(f"{BASE}/joinees", params={"joined_month": "2026-13"}, headers=admin_headers)
    assert response.status_code == 422


def test_joinee_paging_yields_every_row_once(client, admin_headers, data):
    seen = []
    for offset in range(0, 7, 2):
        seen += [r["id"] for r in _get(client, admin_headers, "/joinees", limit=2, offset=offset)["items"]]
    assert len(seen) == len(set(seen)) == 6


def test_joinee_detail_includes_talent_pool_and_order(client, admin_headers, data):
    d = _get(client, admin_headers, f"/joinees/{data['a'].id}")
    assert d["full_name"] == "Anitha R"
    assert d["raw"]["Designation"] == "Assistant Professor"
    assert d["talent_pool_entry"] == {
        "id": str(data["tp"].id),
        "source_tab": "TEACHING_FINAL",
        "sheet_status": "Selected",
        "full_name": "Anitha Pool",
        "is_active": True,
    }
    assert d["provisional_order"]["bio_id"] == "O1"
    assert d["provisional_order"]["room_allotted"] == "A-101"


def test_joinee_detail_404(client, admin_headers):
    assert client.get(f"{BASE}/joinees/{uuid.uuid4()}", headers=admin_headers).status_code == 404


# --- orders ------------------------------------------------------------------


def test_order_summary_hand_counted(client, admin_headers, data):
    s = _get(client, admin_headers, "/orders/summary")
    assert s["total"] == 7
    assert s["by_order_status"] == {"ISSUED": 5, "PENDING": 1, "none": 1}
    assert s["by_outcome"] == {
        "PERMANENT_ORDER_RECEIVED": 1,
        "PROBATION_EXTENDED": 1,
        "NOT_RECOMMENDED": 1,
        # Outcomes only an app mark can record (Step A2), zero-filled.
        "LEFT": 0,
        "REJOIN": 0,
        "TRA": 0,
        "FAMILY_WAY": 0,
        "NO_SUBMIT_PG": 0,
        "LONG_LEAVE": 0,
        "none": 4,
    }
    assert s["probation_due30"] == 3
    assert s["probation_overdue"] == 1
    assert s["probation_ended"] == 2
    assert s["unlinked"] == 6
    assert s["today"] == date.today().isoformat()


def test_every_order_count_equals_its_list(client, admin_headers, data):
    for inactive in (False, True):
        s = _get(client, admin_headers, "/orders/summary", include_inactive=inactive)
        common = {"include_inactive": inactive}
        assert _total(client, admin_headers, "/orders", **common) == s["total"]
        for key, n in s["by_order_status"].items():
            assert _total(client, admin_headers, "/orders", order_status=key, **common) == n, key
        for key, n in s["by_outcome"].items():
            assert _total(client, admin_headers, "/orders", outcome=key, **common) == n, key
        assert _total(client, admin_headers, "/orders", probation="due30", **common) == s["probation_due30"]
        assert _total(client, admin_headers, "/orders", probation="overdue", **common) == s["probation_overdue"]
        assert _total(client, admin_headers, "/orders", probation="ended", **common) == s["probation_ended"]
        assert _total(client, admin_headers, "/orders", linked=False, **common) == s["unlinked"]
        for param, yes, no in (
            ("registrar_order", "registrar_order_issued", "registrar_order_pending"),
            ("orientation", "orientation_conducted", "orientation_pending"),
        ):
            assert _total(client, admin_headers, "/orders", **{param: True}, **common) == s[yes], param
            assert _total(client, admin_headers, "/orders", **{param: False}, **common) == s[no], param


def test_removed_orders_are_hidden_by_default(client, admin_headers, data):
    s = _get(client, admin_headers, "/orders/summary", include_inactive=True)
    assert s["total"] == 8
    assert s["probation_overdue"] == 2  # O8 ended five days ago with no outcome


def test_due30_lists_soonest_first(client, admin_headers, data):
    items = _get(client, admin_headers, "/orders", probation="due30")["items"]
    assert [i["bio_id"] for i in items] == ["O7", "O1", "O2"]


def test_probation_value_is_validated(client, admin_headers):
    assert client.get(f"{BASE}/orders", params={"probation": "soon"}, headers=admin_headers).status_code == 422


def test_order_search(client, admin_headers, data):
    assert _total(client, admin_headers, "/orders", q="a-101") == 1
    assert _total(client, admin_headers, "/orders", q="person o") == 7


# --- departments -------------------------------------------------------------


def test_departments_hand_counted(client, admin_headers, data):
    s = _get(client, admin_headers, "/departments")
    rows = {d["name"]: d for d in s["departments"]}
    assert set(rows) == {"Robotics", "Data Science"}
    r = rows["Robotics"]
    assert (r["approved_total"], r["members"], r["active"], r["active_additional"], r["left"], r["on_leave"],
            r["gap"]) == (4, 4, 3, 1, 1, 1, 1)
    assert r["hods"] == ["Dr Robo Head"]
    d = rows["Data Science"]
    assert (d["approved_total"], d["members"], d["active"], d["left"], d["gap"]) == (2, 2, 1, 1, 1)
    assert d["hods"] == []  # the only HOD has left
    assert s["unmatched"] == [
        {"name": "Additive Manufacuring Engineering", "members": 2},
        {"name": "Not set", "members": 1},
        {"name": "Old Dept", "members": 1},
    ]
    assert s["faculty_total"] == 10
    assert s["unmatched_total"] == 4


def test_every_department_count_equals_its_list(client, admin_headers, data):
    s = _get(client, admin_headers, "/departments")
    for d in s["departments"]:
        name = d["name"]
        assert _total(client, admin_headers, "/faculty", department=name) == d["members"], name
        assert _total(client, admin_headers, "/faculty", department=name, state="active") == d["active"], name
        assert _total(client, admin_headers, "/faculty", department=name, state="active",
                      additional=True) == d["active_additional"], name
        assert _total(client, admin_headers, "/faculty", department=name, state="LEFT") == d["left"], name
        assert _total(client, admin_headers, "/faculty", department=name, state="ON_LEAVE") == d["on_leave"], name
    for u in s["unmatched"]:
        assert _total(client, admin_headers, "/faculty", department=u["name"]) == u["members"], u
    assert _total(client, admin_headers, "/faculty", matched=False) == s["unmatched_total"]
    assert _total(client, admin_headers, "/faculty") == s["faculty_total"]
    assert _total(client, admin_headers, "/faculty", matched=True) == sum(d["members"] for d in s["departments"])


def test_an_inactive_department_reappears_with_include_inactive(client, admin_headers, data):
    s = _get(client, admin_headers, "/departments", include_inactive=True)
    names = {d["name"] for d in s["departments"]}
    assert "Old Dept" in names
    assert {u["name"] for u in s["unmatched"]} == {"Additive Manufacuring Engineering", "Not set"}
    assert s["faculty_total"] == 11
    assert _total(client, admin_headers, "/faculty", department="Old Dept", include_inactive=True) == 1


def test_faculty_rows_carry_department_and_joiner(client, admin_headers, data):
    items = _get(client, admin_headers, "/faculty", department="Robotics", limit=100)["items"]
    assert items[0]["role"] == "HOD"  # HODs first within a department
    assert items[0]["joinee_name"] == "Anitha R"
    assert items[0]["joinee_designation"] == "Assistant Professor"
    assert {i["department_name"] for i in items} == {"Robotics"}
    assert _total(client, admin_headers, "/faculty", role="HOD") == 2
    assert _total(client, admin_headers, "/faculty", role="none") == 1
    assert _total(client, admin_headers, "/faculty", q="f7") == 1
