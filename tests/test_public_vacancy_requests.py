"""The public, unauthenticated vacancy-request intake (2026-08-30).

This is the only unauthenticated write surface in the app besides login/OTP,
so most of these tests are about what it REFUSES to do rather than what it
does:

- it does not trust the payload for anything structural,
- it does not let an anonymous caller set salary, JD text or position title,
- it does not skip the approval workflow or the Sanctioned Strength ceiling,
- it does not hand back internal ids,
- it does not accept unlimited submissions from one IP.

The happy path matters too, but a public endpoint that merely works is not the
bar.
"""

import uuid
from datetime import date, timedelta

import pytest

from app.core import rate_limit
from app.models.enums import (
    StaffRoleCategoryEnum,
    UserRoleEnum,
    VacancyRequestSourceEnum,
    VacancyRequestStatusEnum,
)
from app.models.vacancy_request import VacancyRequest

SUBMIT = "/api/v1/public/vacancy-requests"
OPTIONS = "/api/v1/public/vacancy-requests/form-options"


@pytest.fixture(autouse=True)
def _reset_limits():
    # TestClient requests share one synthetic client IP, so without this the
    # 5-per-5-minutes submit limiter bleeds across tests in this file.
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()


@pytest.fixture()
def intake_setup(
    campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    """Campus/department/designation plus HEADROOM in Sanctioned Strength.

    An active SUPER_ADMIN is required because, with no configured
    QR_INTAKE_USER_EMAIL, the intake attributes submissions to the
    longest-standing active one.

    The sanctioned row matters just as much: a public submission goes through
    `vacancy_workflow.submit()`, so with no sanction at all every request is
    correctly refused with "Only 0 posts available to request". That block is
    pinned by its own test below -- this fixture provides the headroom the
    happy-path tests need.
    """
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Public Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=20, created_by=super_admin
    )
    db_session.commit()
    return campus, department, designation, super_admin


def _payload(campus, department, designation, **overrides):
    body = {
        "campus_id": str(campus.id),
        "department_id": str(department.id),
        "designation_id": str(designation.id),
        "number_of_positions": 2,
        "priority": "NORMAL",
        "justification": "Two faculty retiring at the end of this term.",
        "requester_name": "Priya Raman",
        "requester_email": "priya.raman@example.com",
        "requester_mobile": "+91 98765 43210",
    }
    body.update(overrides)
    return body


# --- it works, without a token ------------------------------------------------


def test_submits_without_authentication_and_returns_only_a_reference(client, intake_setup, db_session):
    campus, department, designation, _admin = intake_setup

    response = client.post(SUBMIT, json=_payload(campus, department, designation))
    assert response.status_code == 201, response.text
    body = response.json()

    # Exactly three fields -- no row id, no campus/department ids, nothing
    # internal a submitter could use as a key to anything.
    assert set(body) == {"request_ref", "status", "submitted_at"}
    assert body["request_ref"].startswith("VR-")
    assert body["status"] == "SUBMITTED"


def test_row_is_recorded_as_a_QR_submission_with_the_requester_details(client, intake_setup, db_session):
    campus, department, designation, _admin = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation)).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.source == VacancyRequestSourceEnum.QR
    assert vr.requester_name == "Priya Raman"
    assert vr.requester_email == "priya.raman@example.com"
    assert vr.requester_mobile == "+91 98765 43210"
    # The person who asked has no User row; requested_by_id is the account
    # that OWNS the intake, which is why the three fields above exist.
    assert vr.requested_by_id is not None


def test_enters_the_normal_workflow_rather_than_appearing_pre_approved(client, intake_setup, db_session):
    """The brief's "status = PENDING" maps to SUBMITTED -- raised, awaiting
    Dean review. It must go through vacancy_workflow.submit(), not be written
    straight into the queue."""
    campus, department, designation, _admin = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation)).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.status == VacancyRequestStatusEnum.SUBMITTED
    # submitted_at is set by the workflow, not by the intake -- its presence
    # is the evidence the choke point actually ran.
    assert vr.submitted_at is not None


def test_derives_position_and_employment_type_from_designation_master(client, intake_setup, db_session):
    campus, department, designation, _admin = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation)).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.position_title == designation.name
    assert vr.employment_type == designation.employment_type
    assert vr.role_category == designation.category


def test_request_refs_are_unique_across_submissions(client, intake_setup):
    campus, department, designation, _admin = intake_setup

    first = client.post(SUBMIT, json=_payload(campus, department, designation)).json()["request_ref"]
    second = client.post(SUBMIT, json=_payload(campus, department, designation)).json()["request_ref"]

    assert first != second


# --- what an anonymous caller must NOT be able to do --------------------------


def test_cannot_set_salary_jd_or_position_title(client, intake_setup, db_session):
    """These are absent from the public schema on purpose. Pydantic drops
    unknown keys silently, so the risk is not a 422 -- it is that they would
    land in a record which later becomes a published job ad."""
    campus, department, designation, _admin = intake_setup

    ref = client.post(
        SUBMIT,
        json=_payload(
            campus,
            department,
            designation,
            salary_band_min=9_000_000,
            salary_band_max=9_999_999,
            jd_draft="Injected job description.",
            position_title="Vice Chancellor",
            status="APPROVED",
        ),
    ).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.salary_band_min is None
    assert vr.salary_band_max is None
    assert vr.jd_draft is None
    assert vr.position_title == designation.name
    assert vr.status == VacancyRequestStatusEnum.SUBMITTED


def test_rejects_a_department_from_another_campus(client, intake_setup, campus_factory, department_factory, db_session):
    campus, _department, designation, _admin = intake_setup
    other_campus = campus_factory("SCLAS")
    foreign_department = department_factory("SCLAS", name=f"Foreign {uuid.uuid4().hex[:6]}")
    foreign_department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    db_session.commit()

    response = client.post(
        SUBMIT, json=_payload(campus, foreign_department, designation)
    )
    assert response.status_code == 400
    assert "campus" in response.json()["detail"].lower()


def test_rejects_a_designation_the_department_does_not_support(
    client, intake_setup, designation_factory, db_session
):
    """The same Department.supports membership rule the authenticated path
    enforces -- NOT designation.category == department.category, which was the
    original bug (see CLAUDE.md)."""
    campus, department, _designation, _admin = intake_setup
    housekeeping = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, housekeeping))
    assert response.status_code == 400
    assert "does not support" in response.json()["detail"].lower()


def test_rejects_an_unknown_campus_with_400_not_404(client, intake_setup):
    """400 rather than 404 throughout: distinct status codes would let an
    anonymous caller probe which ids exist."""
    campus, department, designation, _admin = intake_setup
    body = _payload(campus, department, designation, campus_id=str(uuid.uuid4()))

    response = client.post(SUBMIT, json=body)
    assert response.status_code == 400


def test_requires_a_designation(client, intake_setup):
    """Optional on the authenticated schema, required here: without one there
    is no Sanctioned Strength ceiling to check, so omitting it would be a way
    around the limit."""
    campus, department, designation, _admin = intake_setup
    body = _payload(campus, department, designation)
    del body["designation_id"]

    assert client.post(SUBMIT, json=body).status_code == 422


@pytest.mark.parametrize(
    "field,value",
    [
        ("number_of_positions", 0),
        ("number_of_positions", 101),
        ("justification", "too short"),
        ("requester_email", "not-an-email"),
        ("requester_name", "X"),
        ("requester_mobile", "<script>"),
    ],
)
def test_rejects_malformed_input(client, intake_setup, field, value):
    campus, department, designation, _admin = intake_setup
    response = client.post(SUBMIT, json=_payload(campus, department, designation, **{field: value}))
    assert response.status_code == 422, f"{field}={value!r} should have been rejected"


def test_cannot_request_beyond_the_sanctioned_ceiling(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    """The public form is subject to the same Sanctioned Strength ceiling as
    an in-app request, because it goes through vacancy_workflow.submit()
    rather than writing a row straight into the queue.

    Here there is no sanctioned strength at all, so nothing is available and
    the submission is refused -- a public endpoint that could invent posts
    beyond sanction would be a far worse bug than an over-strict one.
    """
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Unsanctioned {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    user_factory(UserRoleEnum.SUPER_ADMIN)
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, designation))
    assert response.status_code == 409
    assert "available to request" in response.json()["detail"].lower()

    # Nothing was left behind by the refused attempt.
    assert db_session.query(VacancyRequest).filter(VacancyRequest.source == VacancyRequestSourceEnum.QR).count() == 0


def test_rate_limits_repeated_submissions_from_one_ip(client, intake_setup):
    campus, department, designation, _admin = intake_setup

    statuses = [
        client.post(SUBMIT, json=_payload(campus, department, designation)).status_code for _ in range(7)
    ]

    assert statuses.count(201) == 5
    assert statuses[-1] == 429


# --- the options endpoint -----------------------------------------------------


def test_form_options_are_public_and_minimal(client, intake_setup):
    campus, department, designation, _admin = intake_setup

    response = client.get(OPTIONS)
    assert response.status_code == 200
    body = response.json()

    assert {"campuses", "departments", "designations", "locations"} == set(body)
    # Only what a picker needs -- no counts, contact details or audit fields.
    assert set(body["campuses"][0]) == {"id", "code", "name"}
    assert set(body["designations"][0]) == {"id", "name", "category"}


def test_form_options_narrow_departments_to_the_chosen_campus(
    client, intake_setup, campus_factory, department_factory, db_session
):
    campus, department, _designation, _admin = intake_setup
    other = campus_factory("SCLAS")
    department_factory("SCLAS", name=f"Other {uuid.uuid4().hex[:6]}")
    db_session.commit()

    body = client.get(OPTIONS, params={"campus_id": str(campus.id)}).json()

    assert all(d["campus_id"] == str(campus.id) for d in body["departments"])
    assert str(other.id) not in {d["campus_id"] for d in body["departments"]}


def test_form_options_send_block_and_floor_so_locations_are_distinguishable(
    client, intake_setup, location_factory, db_session
):
    """`name` repeats across floors, so a picker keyed on it alone shows
    identical options -- the same problem fixed on the authenticated screens."""
    campus, _department, _designation, _admin = intake_setup
    location_factory("SSE", name="CB Block", block_building="Circular Building", floor_venue="Ground Floor")
    db_session.commit()

    body = client.get(OPTIONS, params={"campus_id": str(campus.id)}).json()

    assert body["locations"]
    assert set(body["locations"][0]) == {"id", "name", "block_building", "floor_venue", "campus_id"}


def test_required_by_is_accepted_and_stored(client, intake_setup, db_session):
    campus, department, designation, _admin = intake_setup
    wanted = date.today() + timedelta(days=45)

    ref = client.post(
        SUBMIT, json=_payload(campus, department, designation, required_by=str(wanted))
    ).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.required_by == wanted
