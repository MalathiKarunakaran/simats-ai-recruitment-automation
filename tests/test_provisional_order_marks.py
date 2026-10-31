"""Step A2: marking the Provisional Orders checklist in the app
(docs/specs/joining-screens.md).

Reuses the hand-counted fixture of tests/test_joining_records.py (orders
O1..O7 active, O8 inactive), so every expected number below is a literal
derived from that docstring plus the marks each test makes.
"""

import pytest

from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum
from app.models.provisional_order_mark import ProvisionalOrderMark
from app.models.sheet_sync import ProvisionalOrder
from app.schemas.sheet_sync import SheetSyncRequest
from app.services.provisional_order_marks import MARK_ACTION, sheet_done
from app.services.sheet_sync import apply_snapshot

from tests.conftest import auth_headers
from tests.test_joining_records import BASE, _get, _total, admin_headers, data  # noqa: F401  (fixtures)


def _order(db_session, bio: str) -> ProvisionalOrder:
    return db_session.query(ProvisionalOrder).filter(ProvisionalOrder.bio_id == bio).one()


def _patch(client, headers, order_id, body, expect=200):
    response = client.patch(f"{BASE}/orders/{order_id}/marks", json=body, headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def _item(client, headers, bio, field):
    items = _get(client, headers, "/orders", q=bio, limit=100)["items"]
    (order,) = [i for i in items if i["bio_id"] == bio]
    return order["items"][field]


def _audit_rows(db_session, order_id):
    db_session.expire_all()
    return db_session.query(AuditLog).filter(AuditLog.action == MARK_ACTION, AuditLog.entity_id == order_id).all()


# --- how a sheet cell reads ----------------------------------------------------


@pytest.mark.parametrize(
    "cell, expected",
    [
        ("Collected", True),
        ("Not Colleted", False),  # the sheet's own spelling
        ("Not Collected", False),
        ("Created", True),
        ("Not Created", False),
        ("Filled", True),
        ("not  filled", False),
        ("YES", True),
        ("", None),
        (None, None),
        ("Pending HR", None),
    ],
)
def test_sheet_cells_read_as_done_or_not(cell, expected):
    assert sheet_done(cell) is expected


# --- marks win over the sheet; clearing reverts -----------------------------------


def test_app_marks_override_the_sheet_in_counts_and_lists(client, admin_headers, db_session, data):
    o4 = _order(db_session, "O4")  # ISSUED, probation ended yesterday, no outcome -> overdue
    o6 = _order(db_session, "O6")  # PENDING
    _patch(client, admin_headers, o4.id, {"order_status": "PENDING", "outcome": "LEFT"})
    _patch(client, admin_headers, o6.id, {"order_status": "ISSUED"})

    s = _get(client, admin_headers, "/orders/summary")
    assert s["by_order_status"] == {"ISSUED": 5, "PENDING": 1, "none": 1}  # one moved each way
    assert s["by_outcome"]["LEFT"] == 1
    assert s["by_outcome"]["none"] == 3
    assert s["probation_overdue"] == 0  # O4 now has an (app) outcome

    assert [i["bio_id"] for i in _get(client, admin_headers, "/orders", order_status="PENDING")["items"]] == ["O4"]
    assert [i["bio_id"] for i in _get(client, admin_headers, "/orders", outcome="LEFT")["items"]] == ["O4"]
    for key, n in s["by_order_status"].items():
        assert _total(client, admin_headers, "/orders", order_status=key) == n, key
    for key, n in s["by_outcome"].items():
        assert _total(client, admin_headers, "/orders", outcome=key) == n, key
    assert _total(client, admin_headers, "/orders", probation="overdue") == s["probation_overdue"]

    item = _item(client, admin_headers, "O4", "outcome")
    assert item["effective"] == "LEFT"
    assert item["sheet"] is None
    assert item["source"] == "app"
    assert item["marked_by"].startswith("Test User")
    assert item["marked_at"] is not None
    # The synced columns themselves are untouched.
    db_session.expire_all()
    assert _order(db_session, "O4").order_status == "ISSUED"
    assert _order(db_session, "O4").outcome is None


def test_checklist_and_room_marks(client, admin_headers, db_session, data):
    o1 = _order(db_session, "O1")  # sheet: id_card "Yes", room "A-101"
    body = _patch(client, admin_headers, o1.id, {"id_card_done": False, "arms_done": True, "room_allotted": " B-7 "})
    assert body["items"]["id_card_done"] == {
        **body["items"]["id_card_done"],
        "effective": False,
        "sheet": True,
        "sheet_raw": "Yes",
        "app": False,
        "source": "app",
    }
    assert body["items"]["arms_done"]["effective"] is True
    assert body["items"]["food_app_done"]["source"] == "sheet"
    assert body["items"]["food_app_done"]["effective"] is None
    assert body["items"]["room_allotted"]["effective"] == "B-7"
    # Search finds the effective room, not the overridden one.
    assert _total(client, admin_headers, "/orders", q="b-7") == 1
    assert _total(client, admin_headers, "/orders", q="a-101") == 0


def test_null_clears_the_app_mark_back_to_the_sheet(client, admin_headers, db_session, data):
    o4 = _order(db_session, "O4")
    _patch(client, admin_headers, o4.id, {"outcome": "TRA", "room_allotted": "C-1"})
    body = _patch(client, admin_headers, o4.id, {"outcome": None})
    assert body["items"]["outcome"]["source"] == "sheet"
    assert body["items"]["outcome"]["effective"] is None
    assert body["items"]["outcome"]["marked_by"] is None
    assert body["items"]["room_allotted"]["effective"] == "C-1"  # not sent, so kept
    assert _get(client, admin_headers, "/orders/summary")["probation_overdue"] == 1

    # A blank room is a clear too.
    body = _patch(client, admin_headers, o4.id, {"room_allotted": "   "})
    assert body["items"]["room_allotted"]["source"] == "sheet"
    db_session.expire_all()
    mark = db_session.query(ProvisionalOrderMark).filter_by(provisional_order_id=o4.id).one()
    assert mark.outcome is None and mark.room_allotted is None
    assert mark.marked == {}


# --- raw-only sheet outcomes (read layer) -------------------------------------


def test_raw_only_sheet_outcomes_count_as_their_outcome(client, admin_headers, db_session, data):
    """Left / Rejoin / TRA / Family Way / No Submit PG / Long Leave arrive from
    the sync with outcome NULL and only outcome_raw set. They must count as
    their outcome (never "no outcome" / overdue); an unknown word still does."""
    from datetime import date, timedelta
    import uuid

    ended = date.today() - timedelta(days=3)
    raw_words = {"R1": "Left", "R2": " rejoin ", "R3": "TRA", "R4": "Family  Way", "R5": "No Submit PG",
                 "R6": "LONG LEAVE", "R7": "Pending HOD"}  # fmt: skip
    for bio, raw in raw_words.items():
        db_session.add(ProvisionalOrder(row_key=uuid.uuid4().hex, bio_id=bio, full_name=f"Raw {bio}", is_active=True,
                                        raw={}, order_status="ISSUED", probation_end_on=ended, outcome=None,
                                        outcome_raw=raw))  # fmt: skip
    db_session.commit()

    s = _get(client, admin_headers, "/orders/summary")
    assert s["total"] == 14
    assert {k: s["by_outcome"][k] for k in ("LEFT", "REJOIN", "TRA", "FAMILY_WAY", "NO_SUBMIT_PG", "LONG_LEAVE")} == {
        "LEFT": 1, "REJOIN": 1, "TRA": 1, "FAMILY_WAY": 1, "NO_SUBMIT_PG": 1, "LONG_LEAVE": 1,
    }  # fmt: skip
    assert s["by_outcome"]["none"] == 5  # the fixture's 4 + "Pending HOD"
    assert s["probation_overdue"] == 2  # O4 + R7 only
    assert {i["bio_id"] for i in _get(client, admin_headers, "/orders", probation="overdue")["items"]} == {"O4", "R7"}
    for key, n in s["by_outcome"].items():
        assert _total(client, admin_headers, "/orders", outcome=key) == n, key
    assert _total(client, admin_headers, "/orders", probation="overdue") == s["probation_overdue"]

    item = _item(client, admin_headers, "R4", "outcome")
    assert (item["effective"], item["sheet"], item["sheet_raw"], item["source"]) == (
        "FAMILY_WAY", "FAMILY_WAY", "Family  Way", "sheet",
    )  # fmt: skip
    assert _item(client, admin_headers, "R7", "outcome")["sheet"] is None

    # An app mark still wins over a mapped raw word, and clearing reverts to it.
    r1 = _order(db_session, "R1")
    _patch(client, admin_headers, r1.id, {"outcome": "REJOIN"})
    s = _get(client, admin_headers, "/orders/summary")
    assert (s["by_outcome"]["LEFT"], s["by_outcome"]["REJOIN"]) == (0, 2)
    _patch(client, admin_headers, r1.id, {"outcome": None})
    assert _get(client, admin_headers, "/orders/summary")["by_outcome"]["LEFT"] == 1


# --- the two app-only items ------------------------------------------------------


def test_registrar_order_and_orientation(client, admin_headers, db_session, data):
    o2 = _order(db_session, "O2")
    o3 = _order(db_session, "O3")
    # A date needs its yes.
    _patch(client, admin_headers, o2.id, {"registrar_order_date": "2026-10-01"}, expect=422)
    _patch(client, admin_headers, o2.id, {"registrar_order_issued": True, "registrar_order_date": "2026-10-01"})
    _patch(client, admin_headers, o3.id, {"orientation_conducted": True, "orientation_date": "2026-09-15"})
    _patch(client, admin_headers, o3.id, {"registrar_order_issued": False})
    # Turning the yes off while the date stays is refused, not silently fixed.
    _patch(client, admin_headers, o2.id, {"registrar_order_issued": False}, expect=422)

    s = _get(client, admin_headers, "/orders/summary")
    assert (s["registrar_order_issued"], s["registrar_order_pending"]) == (1, 6)
    assert (s["orientation_conducted"], s["orientation_pending"]) == (1, 6)
    assert [i["bio_id"] for i in _get(client, admin_headers, "/orders", registrar_order=True)["items"]] == ["O2"]
    assert _total(client, admin_headers, "/orders", registrar_order=False) == 6
    assert [i["bio_id"] for i in _get(client, admin_headers, "/orders", orientation=True)["items"]] == ["O3"]
    assert _total(client, admin_headers, "/orders", orientation=False) == 6

    item = _item(client, admin_headers, "O2", "registrar_order_date")
    assert (item["effective"], item["source"], item["sheet"]) == ("2026-10-01", "app", None)


# --- the sync never touches a mark ------------------------------------------------

O_HEADERS = ["Order Date", "BioID", "EMPID", "Name", "Provision Order", "Probation Period", "ID Card",
             "Food App", "Arms", "360 App", "File Submitted to ADFA", "Room Allotted",
             "After Probation  Received AO "]  # fmt: skip


def _snapshot(*rows: dict) -> SheetSyncRequest:
    return SheetSyncRequest(
        headers=O_HEADERS,
        rows=[{"row_number": n + 2, "cells": [r.get(h, "") for h in O_HEADERS]} for n, r in enumerate(rows)],
    )


def test_a_sync_after_marking_leaves_the_marks_alone(client, admin_headers, db_session):
    row = {"BioID": "S1", "Name": "Synced One", "Order Date": "01-02-2025", "Probation Period": "2/28/2026",
           "Provision Order": "Not Issued", "ID Card": "Not Colleted", "Room Allotted": "A-1"}  # fmt: skip
    apply_snapshot(db_session, "PRO_APP_ORDER", _snapshot(row), dry_run=False)
    db_session.commit()
    order = _order(db_session, "S1")
    _patch(client, admin_headers, order.id, {"id_card_done": True, "order_status": "ISSUED", "room_allotted": "Z-9"})

    # The sheet changes the same cells; the sync updates the mirror only.
    changed = {**row, "ID Card": "Not Colleted", "Provision Order": "Not Issued", "Room Allotted": "A-2",
               "Food App": "Created"}  # fmt: skip
    result = apply_snapshot(db_session, "PRO_APP_ORDER", _snapshot(changed), dry_run=False)
    db_session.commit()
    assert result.counts["updated"] == 1
    db_session.expire_all()
    assert _order(db_session, "S1").room_allotted == "A-2"
    mark = db_session.query(ProvisionalOrderMark).filter_by(provisional_order_id=order.id).one()
    assert (mark.id_card_done, mark.order_status, mark.room_allotted) == (True, "ISSUED", "Z-9")
    assert set(mark.marked) == {"id_card_done", "order_status", "room_allotted"}

    items = _get(client, admin_headers, "/orders", q="S1")["items"][0]["items"]
    assert (items["id_card_done"]["effective"], items["id_card_done"]["sheet"]) == (True, False)
    assert items["room_allotted"]["effective"] == "Z-9"
    assert (items["food_app_done"]["effective"], items["food_app_done"]["source"]) == (True, "sheet")

    # The row leaving the sheet deactivates the order; the mark survives.
    apply_snapshot(db_session, "PRO_APP_ORDER", _snapshot({**row, "BioID": "S2", "Name": "Other"}), dry_run=False)
    db_session.commit()
    db_session.expire_all()
    assert _order(db_session, "S1").is_active is False
    assert db_session.query(ProvisionalOrderMark).filter_by(provisional_order_id=order.id).count() == 1


# --- audit ---------------------------------------------------------------------


def test_one_audit_row_per_call_with_changed_fields_only(client, admin_headers, db_session, data):
    o1 = _order(db_session, "O1")
    _patch(client, admin_headers, o1.id, {"id_card_done": False, "room_allotted": "B-7"})
    _patch(client, admin_headers, o1.id, {"id_card_done": False, "outcome": "REJOIN"})  # id_card unchanged
    _patch(client, admin_headers, o1.id, {"outcome": "REJOIN"})  # no change at all -> no row
    _patch(client, admin_headers, o1.id, {"room_allotted": None})

    # The test transaction gives every row the same now(), so compare as a set.
    rows = _audit_rows(db_session, o1.id)
    assert len(rows) == 3
    states = [(r.before_state, r.after_state) for r in rows]
    assert ({"id_card_done": None, "room_allotted": None}, {"id_card_done": False, "room_allotted": "B-7"}) in states
    assert ({"outcome": None}, {"outcome": "REJOIN"}) in states
    assert ({"room_allotted": "B-7"}, {"room_allotted": None}) in states
    assert all(r.entity_type == "ProvisionalOrder" and r.actor_user_id is not None for r in rows)


# --- roles and validation --------------------------------------------------------


@pytest.mark.parametrize(
    "role", [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR]
)
def test_the_three_markers_can_mark(client, user_factory, db_session, data, role):
    headers = auth_headers(client, user_factory(role, campus_code="SSE"))
    body = _patch(client, headers, _order(db_session, "O3").id, {"app_360_done": True})
    assert body["items"]["app_360_done"]["source"] == "app"


@pytest.mark.parametrize(
    "role",
    [
        UserRoleEnum.RECRUITMENT_OFFICER,
        UserRoleEnum.CAMPUS_HOD,
        UserRoleEnum.MANAGEMENT,
        UserRoleEnum.INTERVIEW_PANEL_MEMBER,
        UserRoleEnum.CANDIDATE,
    ],
)
def test_other_roles_cannot_mark(client, user_factory, db_session, data, role):
    headers = auth_headers(client, user_factory(role, campus_code="SSE"))
    order_id = _order(db_session, "O3").id
    _patch(client, headers, order_id, {"app_360_done": True}, expect=403)
    assert db_session.query(ProvisionalOrderMark).count() == 0


def test_anonymous_and_bad_input(client, admin_headers, db_session, data):
    order_id = _order(db_session, "O3").id
    assert client.patch(f"{BASE}/orders/{order_id}/marks", json={"arms_done": True}).status_code == 401
    _patch(client, admin_headers, "00000000-0000-0000-0000-000000000000", {"arms_done": True}, expect=404)
    _patch(client, admin_headers, order_id, {"outcome": "RECEIVED"}, expect=422)
    _patch(client, admin_headers, order_id, {"order_status": "GENERATED"}, expect=422)
    _patch(client, admin_headers, order_id, {"id_card": "Collected"}, expect=422)  # a sheet column, not a mark


def test_joinee_detail_shows_the_effective_order(client, admin_headers, db_session, data):
    _patch(client, admin_headers, _order(db_session, "O1").id, {"outcome": "LONG_LEAVE"})
    d = _get(client, admin_headers, f"/joinees/{data['a'].id}")
    assert d["provisional_order"]["items"]["outcome"]["effective"] == "LONG_LEAVE"
