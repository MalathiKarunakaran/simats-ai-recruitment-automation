"""GET /api/v1/dashboard/strength-table -- the dashboard's main table
(2026-08-30).

It sits beside `_critical_vacancy_rows` and the difference is the point: that
one hard-filters to VACANCY_RECRUITMENT_REQUIRED and cuts to ten because it
backs a "what is worst right now" card. A main table doing the same could
never render a FULLY_STAFFED or OVERSTAFFED badge, which the brief asks for --
so `recruitment_status` here is optional and absent by default.

The other property worth pinning: this reuses the three Sanctioned Strength
view services rather than querying afresh, so Working honours
`working_override` and the table cannot disagree with the operational screen
it mirrors.
"""

import uuid

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/dashboard/strength-table"


def _table(client, actor, **params):
    return client.get(ENDPOINT, headers=auth_headers(client, actor), params=params)


def _teaching(campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session, *, approved=5, campus_code="SSE"):
    campus = campus_factory(campus_code)
    department = department_factory(campus_code, name=f"Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(
        StaffRoleCategoryEnum.TEACHING, name=f"Desig {uuid.uuid4().hex[:6]}", department=department
    )
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=approved, created_by=hr_admin
    )
    return campus, department, designation, hr_admin, row


def test_returns_the_full_row_shape(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus, department, designation, hr_admin, row = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=5,
    )
    row.working_override = 2
    db_session.commit()

    response = _table(client, hr_admin, role_category="TEACHING")
    assert response.status_code == 200, response.text
    item = [r for r in response.json()["items"] if r["sanctioned_strength_id"] == str(row.id)][0]

    assert item["campus_code"] == "SSE"
    assert item["department_name"] == department.name
    assert item["designation_name"] == designation.name
    assert item["category"] == "TEACHING"
    assert item["approved"] == 5
    # Honours working_override, like the screen this mirrors.
    assert item["working"] == 2
    assert item["vacancy"] == 3
    assert item["filled_pct"] == 40.0
    assert item["status"] == "VACANCY_RECRUITMENT_REQUIRED"


def test_includes_fully_staffed_rows_unlike_the_critical_vacancies_card(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """The whole reason this is not `_critical_vacancy_rows`: a table that
    only ever showed understaffed rows could not render the FULLY STAFFED
    badge the brief specifies."""
    _c, _d, _des, hr_admin, row = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=3,
    )
    row.working_override = 3
    db_session.commit()

    items = _table(client, hr_admin, role_category="TEACHING").json()["items"]
    match = [r for r in items if r["sanctioned_strength_id"] == str(row.id)]
    assert len(match) == 1
    assert match[0]["status"] == "FULLY_STAFFED"
    assert match[0]["vacancy"] == 0


def test_overstaffed_row_is_reported_not_hidden(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, row = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=2,
    )
    row.working_override = 5
    db_session.commit()

    items = _table(client, hr_admin, role_category="TEACHING").json()["items"]
    match = [r for r in items if r["sanctioned_strength_id"] == str(row.id)][0]
    assert match["status"] == "OVERSTAFFED"
    # Signed, not floored -- the sign is what makes OVERSTAFFED meaningful.
    assert match["vacancy"] == -3


def test_sorted_by_highest_vacancy_first(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c1, _d1, _des1, hr_admin, _small = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=2,
    )
    _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=9,
    )
    db_session.commit()

    items = _table(client, hr_admin, role_category="TEACHING").json()["items"]
    vacancies = [r["vacancy"] for r in items]
    assert vacancies == sorted(vacancies, reverse=True)
    assert vacancies[0] == 9


def test_recruitment_status_filter_narrows_the_table(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c1, _d1, _des1, hr_admin, staffed = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=3,
    )
    staffed.working_override = 3
    _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=4,
    )
    db_session.commit()

    unfiltered = _table(client, hr_admin, role_category="TEACHING").json()
    assert unfiltered["total"] == 2

    filtered = _table(
        client, hr_admin, role_category="TEACHING", recruitment_status="VACANCY_RECRUITMENT_REQUIRED"
    ).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["status"] == "VACANCY_RECRUITMENT_REQUIRED"


def test_department_filter_narrows_the_table(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c1, dept_a, _des1, hr_admin, _row_a = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=5,
    )
    _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=6,
    )
    db_session.commit()

    filtered = _table(client, hr_admin, role_category="TEACHING", department_id=str(dept_a.id)).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["department_id"] == str(dept_a.id)


def test_category_filter_narrows_the_table(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=5,
    )
    db_session.commit()

    teaching = _table(client, hr_admin, role_category="TEACHING").json()
    assert teaching["total"] >= 1
    assert {r["category"] for r in teaching["items"]} == {"TEACHING"}

    housekeeping = _table(client, hr_admin, role_category="HOUSEKEEPING").json()
    assert all(r["category"] == "HOUSEKEEPING" for r in housekeeping["items"])


def test_pagination_reports_total_before_slicing(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    _c, _d, _des, hr_admin, _row = _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=5,
    )
    _teaching(
        campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session,
        approved=6,
    )
    db_session.commit()

    page = _table(client, hr_admin, role_category="TEACHING", limit=1).json()
    assert len(page["items"]) == 1
    assert page["total"] == 2
    assert page["limit"] == 1
    assert page["offset"] == 0


def test_empty_scope_returns_zero_not_an_error(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = _table(client, hr_admin, department_id=str(uuid.uuid4()))
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}


def test_malformed_filter_id_is_422(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    assert _table(client, hr_admin, department_id="not-a-uuid").status_code == 422


def test_requires_authentication(client):
    assert client.get(ENDPOINT).status_code == 401
