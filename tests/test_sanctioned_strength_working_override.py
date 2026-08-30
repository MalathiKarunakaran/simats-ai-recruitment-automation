"""Tests for `SanctionedStrength.working_override` (2026-08-29).

The override exists because this deployment runs standalone with no HR feed:
production holds zero `Employee` rows, so the live `working_count_for` count
was 0 on every Teaching/Non-Teaching row, which made Vacancy equal Approved
everywhere and Filled % always 0.

Three properties are what these tests exist to pin down, because each one is
easy to break without any other test noticing:

1. **NULL means "no override"**, so an un-overridden row keeps exactly the
   behaviour it had before the column existed (no backfill was needed).
2. **0 is a real override, not an absent one.** It is falsy, so any
   `if override:` style check would silently fall back to the live count --
   `resolved_working_for` tests `is not None` for exactly this reason.
3. **The delete guard and the reconciliation report deliberately do NOT
   honour it.** Both ask about REAL people: a typed-in figure must never
   unblock a delete that live employee rows should be blocking, and the
   reconciliation report exists precisely to compare sanctioned strength
   against the actual roster.

CRUD/history coverage for the rest of the router lives in
tests/test_sanctioned_strength_crud.py; the Teaching/Non-Teaching view
coverage it builds on lives in tests/test_sanctioned_strength_views.py.
"""

import uuid
from datetime import date
from types import SimpleNamespace

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.sanctioned_strength import SanctionedStrengthHistory
from app.services.sanctioned_strength import (
    compute_availability_to_request,
    list_department_designation_breakdown,
    resolved_working_for,
)

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/sanctioned-strength"
TEACHING_VIEW = "/api/v1/sanctioned-strength/views/teaching"


def _teaching_setup(campus_factory, department_factory, designation_factory, user_factory, db_session, code="SSE"):
    campus = campus_factory(code)
    department = department_factory(code, name=f"Override Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    return campus, department, designation, user_factory(UserRoleEnum.HR_ADMIN)


def _create_payload(campus, department, designation, **extra):
    payload = {
        "campus_id": str(campus.id),
        "department_id": str(department.id),
        "designation_id": str(designation.id),
        "approved_strength": 5,
        "effective_from": str(date.today()),
    }
    payload.update(extra)
    return payload


# --- resolved_working_for: the one resolver ------------------------------------


def test_resolver_no_row_returns_live_count():
    assert resolved_working_for(None, 4) == 4


def test_resolver_null_override_returns_live_count():
    assert resolved_working_for(SimpleNamespace(working_override=None), 4) == 4


def test_resolver_override_wins_over_live_count():
    assert resolved_working_for(SimpleNamespace(working_override=9), 4) == 9


def test_resolver_zero_override_is_an_override_not_an_absence():
    """0 is falsy but MEANINGFUL -- "nobody is working this designation",
    deliberately typed in. A truthiness check here would silently hand back
    the live count instead."""
    assert resolved_working_for(SimpleNamespace(working_override=0), 4) == 0


# --- POST / PATCH round trip ---------------------------------------------------


def test_create_persists_working_override(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )

    response = client.post(
        ENDPOINT,
        json=_create_payload(campus, department, designation, working_override=3),
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 201, response.text
    assert response.json()["working_override"] == 3


def test_create_without_working_override_leaves_it_null(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )

    response = client.post(
        ENDPOINT,
        json=_create_payload(campus, department, designation),
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 201, response.text
    assert response.json()["working_override"] is None


def test_create_negative_working_override_is_422(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )

    response = client.post(
        ENDPOINT,
        json=_create_payload(campus, department, designation, working_override=-1),
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 422


def test_patch_sets_working_override(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"working_override": 4}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200, response.text
    assert response.json()["working_override"] == 4

    db_session.refresh(row)
    assert row.working_override == 4


def test_patch_omitting_working_override_leaves_it_alone(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The router keys off `model_fields_set`, not `is not None` -- omitting
    the key must not be read as "clear it"."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 2
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"remarks": "unrelated edit"}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200, response.text
    assert response.json()["working_override"] == 2

    db_session.refresh(row)
    assert row.working_override == 2


def test_patch_explicit_null_clears_working_override(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The other half of the `model_fields_set` decision: sending null is a
    real instruction -- hand the row back to the live count."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 2
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"working_override": None}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200, response.text
    assert response.json()["working_override"] is None

    db_session.refresh(row)
    assert row.working_override is None


def test_patch_working_override_writes_no_strength_history(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """`SanctionedStrengthHistory` tracks the *sanction* (approved_strength),
    not the roster figure -- same rule remarks already follow."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"working_override": 4}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200

    history = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .all()
    )
    assert history == []


# --- Teaching view: every derived number moves together ------------------------


def test_view_row_derives_working_vacancy_and_filled_pct_from_the_override(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session, code="SPIER"
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 2
    db_session.commit()

    response = client.get(
        TEACHING_VIEW, headers=auth_headers(client, hr_admin), params={"department_id": str(department.id)}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    match = [r for r in body["items"] if r["sanctioned_strength_id"] == str(row.id)]
    assert len(match) == 1
    item = match[0]
    # Without the override every one of these would read 0 / 5 / 0.0.
    assert item["working"] == 2
    assert item["vacancy"] == 3
    assert item["filled_pct"] == 40.0
    assert item["status"] == "VACANCY_RECRUITMENT_REQUIRED"


def test_view_row_override_equal_to_approved_reads_fully_staffed(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session, code="SPIER"
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=4, created_by=hr_admin
    )
    row.working_override = 4
    db_session.commit()

    response = client.get(
        TEACHING_VIEW, headers=auth_headers(client, hr_admin), params={"department_id": str(department.id)}
    )
    assert response.status_code == 200, response.text
    item = [r for r in response.json()["items"] if r["sanctioned_strength_id"] == str(row.id)][0]
    assert item["working"] == 4
    assert item["vacancy"] == 0
    assert item["filled_pct"] == 100.0
    assert item["status"] == "FULLY_STAFFED"


def test_view_kpi_totals_are_summed_from_the_overridden_rows(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The KPI strip sums each row's own `working`/`vacancy`, so it inherits
    the override rather than re-deriving a figure that would disagree with
    the table under it."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session, code="SPIER"
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=6, created_by=hr_admin
    )
    row.working_override = 2
    db_session.commit()

    response = client.get(
        TEACHING_VIEW, headers=auth_headers(client, hr_admin), params={"department_id": str(department.id)}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["approved_total"] == 6
    assert body["working_total"] == 2
    assert body["vacancy_total"] == 4


def test_view_zero_override_beats_a_real_live_employee(
    client, published_vacancy_factory, hired_employee_factory, designation_factory,
    sanctioned_strength_factory, db_session
):
    """The falsy-0 case end to end: one genuinely active employee, an
    override of 0, and the view must report 0 -- not fall back to 1."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()

    row = sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=3,
        created_by=vacancy.hr_admin,
    )
    row.working_override = 0
    db_session.commit()

    response = client.get(
        TEACHING_VIEW,
        headers=auth_headers(client, vacancy.hr_admin),
        params={"department_id": str(vacancy.department.id)},
    )
    assert response.status_code == 200, response.text
    item = [r for r in response.json()["items"] if r["sanctioned_strength_id"] == str(row.id)][0]
    assert item["working"] == 0
    assert item["vacancy"] == 3


# --- the other two service read paths ------------------------------------------


def test_department_breakdown_honours_the_override(
    campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 3
    db_session.flush()

    rows = list_department_designation_breakdown(db_session, department.id)
    match = [r for r in rows if r["designation_id"] == designation.id][0]
    assert match["working"] == 3
    assert match["vacancy"] == 2
    # The raw override rides along beside the resolved figure -- an edit form
    # cannot tell "someone typed 3" from "3 people are employed" otherwise.
    assert match["working_override"] == 3


def test_department_breakdown_reports_null_override_when_none_is_set(
    campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.flush()

    rows = list_department_designation_breakdown(db_session, department.id)
    match = [r for r in rows if r["designation_id"] == designation.id][0]
    assert match["working"] == 0
    assert match["working_override"] is None


def test_availability_to_request_honours_the_override(
    campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """This one also gates `vacancy_workflow.submit()` -- an override that
    fills the sanction closes the key to further requests."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 5
    db_session.flush()

    availability = compute_availability_to_request(
        db_session, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert availability["approved"] == 5
    assert availability["working"] == 5
    assert availability["vacant"] == 0
    assert availability["available_to_request"] == 0


# --- deliberately NOT overridden -----------------------------------------------


def test_delete_guard_ignores_the_override_and_still_blocks(
    client, published_vacancy_factory, hired_employee_factory, designation_factory,
    sanctioned_strength_factory, db_session
):
    """The guard asks about REAL people. A typed-in 0 must never unblock a
    delete that a live employee row should be blocking."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)
    designation = designation_factory(department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()

    row = sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=2,
        created_by=vacancy.hr_admin,
    )
    row.working_override = 0
    db_session.commit()

    response = client.delete(f"{ENDPOINT}/{row.id}", headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 409
    assert "1" in response.json()["detail"]

    db_session.refresh(row)
    assert row.is_active is True


def test_delete_guard_ignores_the_override_and_still_allows(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The mirror image: an override of 5 with nobody actually employed must
    not invent a blocker."""
    campus, department, designation, hr_admin = _teaching_setup(
        campus_factory, department_factory, designation_factory, user_factory, db_session
    )
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    row.working_override = 5
    db_session.commit()

    response = client.delete(f"{ENDPOINT}/{row.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 204

    db_session.refresh(row)
    assert row.is_active is False
