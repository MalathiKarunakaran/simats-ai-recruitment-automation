"""Dashboard drill-down filters, the vacancy_by_* charts, and the two pending
counts (2026-08-30 dashboard redesign).

Two properties these exist to pin down:

1. **Every number on the dashboard comes from one place.** The tiles and all
   three charts are built from the same `current_effective_rows` +
   `_resolved_working` pair, so a chart can never contradict the card above
   it. Computing each from its own query is the failure mode being avoided.

2. **The dashboard honours `working_override`.** Before this change
   `_sanctioned_strength_totals` called `working_count_for` directly, so a
   manually-entered headcount showed on the Sanctioned Strength screen but
   not on the dashboard summarising it. With no HR feed in this deployment
   that read as Working 0 / Vacancy = Approved next to a page showing real
   figures. `sanctioned_strength_reconciliation_report` still counts live
   Employee rows on purpose -- see tests/test_reports.py.

Every filter is additive and optional: a call passing none of them must
return exactly what it returned before they existed.
"""

import uuid

from app.models.enums import (
    EmploymentTypeEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
    VacancyRequestStatusEnum,
)
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/dashboard/kpis"


def _no_strength(**_kwargs):
    """Stand-in for sanctioned_strength_factory where a test wants the
    campus/department/designation scaffolding but no sanctioned row."""
    return None


def _kpis(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def _teaching_row(
    campus_factory,
    department_factory,
    designation_factory,
    sanctioned_strength_factory,
    user_factory,
    db_session,
    *,
    campus_code="SSE",
    approved=5,
    dept_name=None,
    designation_name=None,
):
    campus = campus_factory(campus_code)
    department = department_factory(campus_code, name=dept_name or f"Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(
        StaffRoleCategoryEnum.TEACHING, name=designation_name or f"Desig {uuid.uuid4().hex[:6]}", department=department
    )
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=approved, created_by=hr_admin
    )
    return campus, department, designation, hr_admin, row


# --- the override-consistency fix ---------------------------------------------


def test_dashboard_working_total_honours_working_override(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The whole point: the dashboard must agree with the Sanctioned Strength
    screen. Without the override the roster is empty, so Working would be 0
    and Vacancy would equal Approved."""
    _c, _d, _des, hr_admin, row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    row.working_override = 3
    db_session.commit()

    body = _kpis(client, hr_admin, role_category="TEACHING").json()
    assert body["sanctioned_approved_total"] == 5
    assert body["sanctioned_working_total"] == 3
    assert body["sanctioned_vacancy_total"] == 2


def test_dashboard_totals_unchanged_when_no_override_is_set(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The additive half: a row with no override keeps the exact behaviour it
    had before `_resolved_working` existed."""
    _c, _d, _des, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=4,
    )
    db_session.commit()

    body = _kpis(client, hr_admin, role_category="TEACHING").json()
    assert body["sanctioned_approved_total"] == 4
    assert body["sanctioned_working_total"] == 0
    assert body["sanctioned_vacancy_total"] == 4


# --- recruitment_required_count is a ROW count, not a headcount ---------------


def test_recruitment_required_counts_rows_not_headcount(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin, row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=9,
    )
    db_session.commit()

    body = _kpis(client, hr_admin, role_category="TEACHING").json()
    # One row short by nine people: a headcount of 9, but ONE row needing
    # recruitment. Conflating the two is the trap this pins.
    assert body["sanctioned_vacancy_total"] == 9
    assert body["recruitment_required_count"] == 1


def test_fully_staffed_row_is_not_recruitment_required(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=3,
    )
    row.working_override = 3
    db_session.commit()

    body = _kpis(client, hr_admin, role_category="TEACHING").json()
    assert body["sanctioned_vacancy_total"] == 0
    assert body["recruitment_required_count"] == 0


# --- pending counts do not overlap --------------------------------------------


def test_pending_requests_and_approvals_are_non_overlapping(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    """SUBMITTED awaits a Dean; DEAN_APPROVED awaits HR. A request must never
    be counted by both cards -- and a DRAFT, which nobody is waiting on, by
    neither."""
    campus, department, designation, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, _no_strength, user_factory, db_session
    )
    for status in (
        VacancyRequestStatusEnum.SUBMITTED,
        VacancyRequestStatusEnum.DEAN_APPROVED,
        VacancyRequestStatusEnum.DRAFT,
    ):
        db_session.add(
            VacancyRequest(
                campus_id=campus.id,
                department_id=department.id,
                designation_id=designation.id,
                role_category=StaffRoleCategoryEnum.TEACHING,
                position_title=f"Role-{uuid.uuid4().hex[:6]}",
                employment_type=EmploymentTypeEnum.FULL_TIME,
                requested_count=1,
                qualification="PhD",
                experience_required="1 year",
                requested_by_id=hr_admin.id,
                status=status,
            )
        )
    db_session.commit()

    body = _kpis(client, hr_admin).json()
    assert body["pending_requests_count"] == 1
    assert body["pending_approvals_count"] == 1


# --- drill-down filters --------------------------------------------------------


def test_department_filter_narrows_the_totals(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c1, dept_a, _des1, hr_admin, row_a = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=7,
    )
    db_session.commit()

    unfiltered = _kpis(client, hr_admin, role_category="TEACHING").json()
    assert unfiltered["sanctioned_approved_total"] == 12

    filtered = _kpis(client, hr_admin, role_category="TEACHING", department_id=str(dept_a.id)).json()
    assert filtered["sanctioned_approved_total"] == 5


def test_designation_filter_narrows_the_totals(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, designation_a, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=6,
    )
    db_session.commit()

    filtered = _kpis(client, hr_admin, role_category="TEACHING", designation_id=str(designation_a.id)).json()
    assert filtered["sanctioned_approved_total"] == 5


def test_unknown_filter_id_yields_zeros_not_an_error(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    db_session.commit()

    body = _kpis(client, hr_admin, department_id=str(uuid.uuid4())).json()
    assert body["sanctioned_approved_total"] == 0
    assert body["recruitment_required_count"] == 0
    # Zeros, not an empty-state error -- the brief is explicit that a filtered
    # scope with nothing in it shows 0.
    assert body["vacancy_by_department"] == []


def test_malformed_filter_id_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _kpis(client, hr_admin, department_id="not-a-uuid")
    assert response.status_code == 422


def test_omitting_every_new_filter_is_unchanged_behaviour(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    db_session.commit()

    assert _kpis(client, hr_admin).status_code == 200


# --- vacancy_by_* charts agree with the tiles ---------------------------------


def test_vacancy_by_department_matches_the_headline_total(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The anti-drift property: the chart is built from the same rows as the
    card, so their vacancies must sum to the same number."""
    _c1, _d1, _des1, hr_admin, row_a = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    row_a.working_override = 1
    _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=4,
    )
    db_session.commit()

    body = _kpis(client, hr_admin, role_category="TEACHING").json()
    chart_total = sum(row["vacancy"] for row in body["vacancy_by_department"])
    assert chart_total == body["sanctioned_vacancy_total"] == 8


def test_vacancy_by_department_is_sorted_highest_first(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c1, _d1, _des1, hr_admin, _row_a = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=2,
    )
    _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=9,
    )
    db_session.commit()

    rows = _kpis(client, hr_admin, role_category="TEACHING").json()["vacancy_by_department"]
    assert [r["vacancy"] for r in rows] == [9, 2]


def test_vacancy_by_category_labels_use_the_enum_value(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5,
    )
    db_session.commit()

    rows = _kpis(client, hr_admin, role_category="TEACHING").json()["vacancy_by_category"]
    assert [r["label"] for r in rows] == ["TEACHING"]


def test_vacancy_by_campus_groups_by_campus_code(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching_row(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory,
        db_session, approved=5, campus_code="SPIER",
    )
    db_session.commit()

    rows = _kpis(client, hr_admin, role_category="TEACHING").json()["vacancy_by_campus"]
    assert [r["label"] for r in rows] == ["SPIER"]
    assert rows[0]["vacancy"] == 5
