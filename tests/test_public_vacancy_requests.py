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
from app.models.location import Location
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers

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
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    sanctioned_strength_factory,
    user_factory,
    db_session,
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
    # Location is REQUIRED on the public form as of 2026-09-02, so every
    # payload here needs one. Created with category=None on purpose: a
    # Location is a physical place and nothing in this flow may narrow it by
    # staff category -- the tests below submit TEACHING and NON_TEACHING
    # requests against this same row.
    location = location_factory("SSE", name="Circular Building", block_building="Circular Building",
                                floor_venue="Ground Floor")
    db_session.commit()
    return campus, department, designation, super_admin, location


def _payload(campus, department, designation, location, **overrides):
    body = {
        "campus_id": str(campus.id),
        "department_id": str(department.id),
        "designation_id": str(designation.id),
        "location_id": str(location.id),
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
    campus, department, designation, _admin, location = intake_setup

    response = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert response.status_code == 201, response.text
    body = response.json()

    # Exactly three fields -- no row id, no campus/department ids, nothing
    # internal a submitter could use as a key to anything.
    assert set(body) == {"request_ref", "status", "submitted_at"}
    assert body["request_ref"].startswith("VR-")
    assert body["status"] == "SUBMITTED"


def test_row_is_recorded_as_a_QR_submission_with_the_requester_details(client, intake_setup, db_session):
    campus, department, designation, _admin, location = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation, location)).json()["request_ref"]

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
    campus, department, designation, _admin, location = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation, location)).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.status == VacancyRequestStatusEnum.SUBMITTED
    # submitted_at is set by the workflow, not by the intake -- its presence
    # is the evidence the choke point actually ran.
    assert vr.submitted_at is not None


def test_derives_position_and_employment_type_from_designation_master(client, intake_setup, db_session):
    campus, department, designation, _admin, location = intake_setup

    ref = client.post(SUBMIT, json=_payload(campus, department, designation, location)).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.position_title == designation.name
    assert vr.employment_type == designation.employment_type
    assert vr.role_category == designation.category


def test_request_refs_are_unique_across_submissions(client, intake_setup):
    campus, department, designation, _admin, location = intake_setup

    first = client.post(SUBMIT, json=_payload(campus, department, designation, location)).json()["request_ref"]
    # A second requester: the same email inside the cooldown is refused (audit L5).
    second = client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                               requester_email="second.person@example.com")).json()["request_ref"]

    assert first != second


# --- what an anonymous caller must NOT be able to do --------------------------


def test_cannot_set_salary_jd_or_position_title(client, intake_setup, db_session):
    """These are absent from the public schema on purpose. Pydantic drops
    unknown keys silently, so the risk is not a 422 -- it is that they would
    land in a record which later becomes a published job ad."""
    campus, department, designation, _admin, location = intake_setup

    ref = client.post(
        SUBMIT,
        json=_payload(
            campus,
            department,
            designation,
            location,
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
    campus, _department, designation, _admin, location = intake_setup
    other_campus = campus_factory("SCLAS")
    foreign_department = department_factory("SCLAS", name=f"Foreign {uuid.uuid4().hex[:6]}")
    foreign_department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    db_session.commit()

    response = client.post(
        SUBMIT, json=_payload(campus, foreign_department, designation, location)
    )
    assert response.status_code == 400
    assert "campus" in response.json()["detail"].lower()


def test_rejects_a_designation_the_department_does_not_support(
    client, intake_setup, designation_factory, db_session
):
    """The same Department.supports membership rule the authenticated path
    enforces -- NOT designation.category == department.category, which was the
    original bug (see CLAUDE.md)."""
    campus, department, _designation, _admin, location = intake_setup
    housekeeping = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, housekeeping, location))
    assert response.status_code == 400
    assert "does not support" in response.json()["detail"].lower()


def test_rejects_an_unknown_campus_with_400_not_404(client, intake_setup):
    """400 rather than 404 throughout: distinct status codes would let an
    anonymous caller probe which ids exist."""
    campus, department, designation, _admin, location = intake_setup
    body = _payload(campus, department, designation, location, campus_id=str(uuid.uuid4()))

    response = client.post(SUBMIT, json=body)
    assert response.status_code == 400


def test_requires_a_designation(client, intake_setup):
    """Optional on the authenticated schema, required here: without one there
    is no Sanctioned Strength ceiling to check, so omitting it would be a way
    around the limit."""
    campus, department, designation, _admin, location = intake_setup
    body = _payload(campus, department, designation, location)
    del body["designation_id"]

    assert client.post(SUBMIT, json=body).status_code == 422


@pytest.mark.parametrize(
    "field,value",
    [
        ("number_of_positions", 0),
        ("number_of_positions", -1),
        ("number_of_positions", 1.5),
        ("number_of_positions", "two"),
        ("number_of_positions", 101),
        ("justification", "too short"),
        # Whitespace-only satisfied Field(min_length=10) before 2026-09-02:
        # that runs against the RAW string, and ten spaces are ten
        # characters. The stripping validator is what catches it.
        ("justification", "            "),
        ("requester_email", "not-an-email"),
        ("requester_name", "X"),
        ("requester_name", "   "),
        ("requester_mobile", "<script>"),
        # Indian mobile rules, tightened 2026-09-02.
        ("requester_mobile", "5876543210"),
        ("requester_mobile", "98765abcde"),
        ("requester_mobile", "987654321"),
        ("requester_mobile", "98765432101"),
    ],
)
def test_rejects_malformed_input(client, intake_setup, field, value):
    campus, department, designation, _admin, location = intake_setup
    response = client.post(SUBMIT, json=_payload(campus, department, designation, location, **{field: value}))
    assert response.status_code == 422, f"{field}={value!r} should have been rejected"


def test_cannot_request_beyond_the_sanctioned_ceiling(
    client, campus_factory, department_factory, designation_factory, location_factory, user_factory, db_session
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
    location = location_factory("SSE", name="Unsanctioned Block")
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert response.status_code == 409
    assert "available to request" in response.json()["detail"].lower()

    # Nothing was left behind by the refused attempt.
    assert db_session.query(VacancyRequest).filter(VacancyRequest.source == VacancyRequestSourceEnum.QR).count() == 0


def test_rate_limits_repeated_submissions_from_one_ip(client, intake_setup):
    campus, department, designation, _admin, location = intake_setup

    # A fresh email each time, so the per-email cooldown (audit L5) stays out of
    # the way and only the per-IP limiter is being measured.
    statuses = [
        client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                          requester_email=f"person{i}@example.com")).status_code
        for i in range(7)
    ]

    assert statuses.count(201) == 5
    assert statuses[-1] == 429


# --- the options endpoint -----------------------------------------------------


def test_form_options_are_public_and_minimal(client, intake_setup):
    campus, department, designation, _admin, location = intake_setup

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
    campus, department, _designation, _admin, location = intake_setup
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
    campus, _department, _designation, _admin, location = intake_setup
    location_factory("SSE", name="CB Block", block_building="Circular Building", floor_venue="Ground Floor")
    db_session.commit()

    body = client.get(OPTIONS, params={"campus_id": str(campus.id)}).json()

    assert body["locations"]
    assert set(body["locations"][0]) == {"id", "name", "block_building", "floor_venue", "campus_id"}


def test_required_by_is_accepted_and_stored(client, intake_setup, db_session):
    campus, department, designation, _admin, location = intake_setup
    wanted = date.today() + timedelta(days=45)

    ref = client.post(
        SUBMIT, json=_payload(campus, department, designation, location, required_by=str(wanted))
    ).json()["request_ref"]

    vr = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == ref).one()
    assert vr.required_by == wanted


# --- rules tightened 2026-09-02 -----------------------------------------------


def test_location_is_required(client, intake_setup):
    """Location is mandatory 2026-09-02 -- but only where the campus HAS
    locations, which is why this is a 400 from the shared rule rather than a
    422 from the schema. The DB column stays nullable: rows created before
    this must remain valid. See `vacancy_request_rules.validate_location`.
    """
    campus, department, designation, _admin, location = intake_setup
    body = _payload(campus, department, designation, location)
    del body["location_id"]

    response = client.post(SUBMIT, json=body)

    assert response.status_code == 400
    assert response.json()["detail"] == "Location is required for this campus."


def test_location_must_belong_to_the_chosen_campus(client, intake_setup, location_factory, db_session):
    campus, department, designation, _admin, _location = intake_setup
    foreign = location_factory("SCAD", name="Other Campus Block")
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, designation, foreign))

    assert response.status_code == 400
    assert "does not belong to the selected campus" in response.json()["detail"].lower()


@pytest.mark.parametrize("category", [StaffRoleCategoryEnum.TEACHING, StaffRoleCategoryEnum.NON_TEACHING])
def test_the_same_location_is_accepted_for_teaching_and_non_teaching(
    client,
    campus_factory,
    department_factory,
    designation_factory,
    location_factory,
    sanctioned_strength_factory,
    user_factory,
    db_session,
    category,
):
    """A Location is a physical place, so the SAME one must be usable by a
    Teaching and a Non-Teaching request alike.

    Regression guard for the class of bug fixed in `d28d72c`, where a category
    filter on a location picker left every NON_TEACHING row with an empty
    dropdown. The location here is categorised TEACHING on purpose -- the
    worst case, and the shape of all 23 rows in production -- and a
    NON_TEACHING request must still be accepted against it.
    """
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Both Cats {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING, StaffRoleCategoryEnum.NON_TEACHING]
    designation = designation_factory(category, department=department)
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=admin
    )
    location = location_factory("SSE", name="Shared Block", category=StaffRoleCategoryEnum.TEACHING)
    db_session.commit()

    response = client.post(SUBMIT, json=_payload(campus, department, designation, location))

    assert response.status_code == 201, response.text
    vr = (
        db_session.query(VacancyRequest)
        .filter(VacancyRequest.request_ref == response.json()["request_ref"])
        .one()
    )
    assert vr.location_id == location.id
    assert vr.role_category is category


def test_rejects_a_required_by_date_in_the_past(client, intake_setup):
    campus, department, designation, _admin, location = intake_setup
    yesterday = date.today() - timedelta(days=1)

    response = client.post(
        SUBMIT, json=_payload(campus, department, designation, location, required_by=str(yesterday))
    )

    assert response.status_code == 422


def test_accepts_a_required_by_date_of_today(client, intake_setup):
    """The boundary is inclusive -- needing a post filled today is a real, if
    optimistic, request, and rejecting it would be an off-by-one."""
    campus, department, designation, _admin, location = intake_setup

    response = client.post(
        SUBMIT, json=_payload(campus, department, designation, location, required_by=str(date.today()))
    )

    assert response.status_code == 201, response.text


@pytest.mark.parametrize(
    "mobile",
    ["9876543210", "+91 98765 43210", "0091-98765-43210", "098765 43210", "919876543210"],
)
def test_accepts_the_indian_mobile_formats_staff_actually_type(client, intake_setup, db_session, mobile):
    campus, department, designation, _admin, location = intake_setup

    response = client.post(
        SUBMIT, json=_payload(campus, department, designation, location, requester_mobile=mobile)
    )

    assert response.status_code == 201, response.text
    vr = (
        db_session.query(VacancyRequest)
        .filter(VacancyRequest.request_ref == response.json()["request_ref"])
        .one()
    )
    # Stored as typed (trimmed), not reformatted -- a recruiter reads and
    # dials this, and silently rewriting it would be a surprise.
    assert vr.requester_mobile == mobile


def test_justification_and_name_are_stored_trimmed(client, intake_setup, db_session):
    campus, department, designation, _admin, location = intake_setup

    response = client.post(
        SUBMIT,
        json=_payload(
            campus,
            department,
            designation,
            location,
            justification="   Two faculty retiring at the end of term.   ",
            requester_name="  Priya Raman  ",
        ),
    )

    assert response.status_code == 201, response.text
    vr = (
        db_session.query(VacancyRequest)
        .filter(VacancyRequest.request_ref == response.json()["request_ref"])
        .one()
    )
    # remarks is where the public form's justification lands.
    assert vr.remarks == "Two faculty retiring at the end of term."
    assert vr.requester_name == "Priya Raman"


def test_form_options_say_which_categories_each_department_supports(client, intake_setup):
    """Sent so the form can offer only the designations a department may
    actually contain. Without it, picking a Non-Teaching designation on a
    Teaching-only department looked fine on screen and failed with a 400 at
    submit, after the whole form had been filled in on a phone."""
    campus, department, _designation, _admin, _location = intake_setup

    body = client.get(OPTIONS, params={"campus_id": str(campus.id)}).json()

    row = next(d for d in body["departments"] if d["id"] == str(department.id))
    assert row["supported_categories"] == ["TEACHING"]


def test_form_options_do_not_filter_locations_by_category(client, intake_setup, location_factory, db_session):
    """Every active location on the campus is offered, whatever its category.

    Production holds 23 locations and every one is categorised TEACHING; a
    category filter here would leave a Non-Teaching requester facing an empty,
    now-mandatory dropdown -- the exact bug `d28d72c` fixed elsewhere.
    """
    campus, _department, _designation, _admin, _location = intake_setup
    location_factory("SSE", name="Teaching Only Block", category=StaffRoleCategoryEnum.TEACHING)
    location_factory("SSE", name="Housekeeping Block", category=StaffRoleCategoryEnum.HOUSEKEEPING)
    db_session.commit()

    body = client.get(OPTIONS, params={"campus_id": str(campus.id)}).json()

    names = {loc["name"] for loc in body["locations"]}
    assert {"Teaching Only Block", "Housekeeping Block"} <= names


def test_location_is_optional_on_a_campus_that_has_none(
    client, campus_factory, department_factory, designation_factory,
    sanctioned_strength_factory, user_factory, db_session
):
    """The other half of the rule, and the reason it is conditional at all.

    At the time of writing only 2 of 7 production campuses have any locations
    (SSE 18, SSPE 4; the other five have zero). A flat requirement made it
    impossible to raise a request on those five -- a far worse failure than a
    missing location. This campus has no Location rows, so the field is
    optional and the submission goes through.
    """
    campus = campus_factory("SCLAS")
    department = department_factory("SCLAS", name=f"No Locations {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=4, created_by=admin
    )
    db_session.commit()
    assert db_session.query(Location).filter(Location.campus_id == campus.id).count() == 0

    body = {
        "campus_id": str(campus.id), "department_id": str(department.id),
        "designation_id": str(designation.id), "number_of_positions": 1, "priority": "NORMAL",
        "justification": "This campus has no locations set up yet.",
        "requester_name": "Priya Raman", "requester_email": "priya@example.com",
        "requester_mobile": "9876543210",
    }
    response = client.post(SUBMIT, json=body)

    assert response.status_code == 201, response.text
    vr = db_session.query(VacancyRequest).filter(
        VacancyRequest.request_ref == response.json()["request_ref"]
    ).one()
    assert vr.location_id is None


def test_the_rule_tightens_by_itself_once_a_campus_gets_its_first_location(
    client, campus_factory, department_factory, designation_factory, location_factory,
    sanctioned_strength_factory, user_factory, db_session
):
    """No code change, no migration: adding location master data is what makes
    the field mandatory for that campus."""
    campus = campus_factory("SPIER")
    department = department_factory("SPIER", name=f"Tightens {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=9, created_by=admin
    )
    db_session.commit()

    body = {
        "campus_id": str(campus.id), "department_id": str(department.id),
        "designation_id": str(designation.id), "number_of_positions": 1, "priority": "NORMAL",
        "justification": "Before this campus has any locations at all.",
        "requester_name": "Priya Raman", "requester_email": "priya@example.com",
        "requester_mobile": "9876543210",
    }
    assert client.post(SUBMIT, json=body).status_code == 201

    location_factory("SPIER", name="First Block")
    db_session.commit()

    body["requester_email"] = "another.person@example.com"  # not the cooldown (audit L5), the location rule
    refused = client.post(SUBMIT, json=body)
    assert refused.status_code == 400
    assert refused.json()["detail"] == "Location is required for this campus."


# --- Audit L5: honeypot + per-email cooldown, on top of the per-IP limiter ------


def _blocked_events(db_session):
    from app.models.audit_log import AuditLog

    return db_session.query(AuditLog).filter(AuditLog.action == "PUBLIC_VACANCY_REQUEST_BLOCKED").all()


def _qr_rows(db_session):
    from app.models.vacancy_request import VacancyRequest

    return db_session.query(VacancyRequest).filter(VacancyRequest.source == VacancyRequestSourceEnum.QR).count()


def test_legitimate_submission_sends_an_empty_honeypot_and_succeeds(client, intake_setup, db_session):
    # A: the form always sends the field, empty.
    campus, department, designation, _admin, location = intake_setup
    response = client.post(SUBMIT, json=_payload(campus, department, designation, location, website=""))
    assert response.status_code == 201, response.text
    assert _blocked_events(db_session) == []


def test_filled_honeypot_is_refused_generically_creates_nothing_and_is_audited(client, intake_setup, db_session):
    # B + J + K
    campus, department, designation, _admin, location = intake_setup
    before = _qr_rows(db_session)
    response = client.post(SUBMIT, json=_payload(campus, department, designation, location, website="http://spam.example"))
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "website" not in detail.lower() and "honeypot" not in detail.lower()
    assert "priya" not in detail.lower() and "VR-" not in detail
    assert _qr_rows(db_session) == before
    events = _blocked_events(db_session)
    assert len(events) == 1 and events[0].after_state == {"reason": "honeypot"}
    assert "priya" not in str(events[0].after_state).lower()  # nothing from the payload is stored


def test_second_submission_from_the_same_email_inside_the_cooldown_is_refused(client, intake_setup, db_session):
    # C + J + K
    campus, department, designation, _admin, location = intake_setup
    first = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert first.status_code == 201, first.text
    rows_after_first = _qr_rows(db_session)

    second = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert second.status_code == 429
    detail = second.json()["detail"]
    assert "priya" not in detail.lower() and "VR-" not in detail and "@" not in detail
    assert _qr_rows(db_session) == rows_after_first
    events = _blocked_events(db_session)
    assert len(events) == 1 and events[0].after_state == {"reason": "cooldown"}


def test_the_cooldown_compares_normalised_emails(client, intake_setup):
    campus, department, designation, _admin, location = intake_setup
    assert client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                             requester_email="Priya.Raman@Example.com")).status_code == 201
    assert client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                             requester_email="  priya.raman@example.com ")).status_code == 429


def test_submission_after_the_cooldown_is_allowed(client, intake_setup, db_session):
    # D: age the first row past the window.
    from datetime import datetime, timedelta, timezone

    from app.models.vacancy_request import VacancyRequest
    from app.services.vacancy_request_intake import PUBLIC_SUBMISSION_COOLDOWN

    campus, department, designation, _admin, location = intake_setup
    first = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert first.status_code == 201
    row = db_session.query(VacancyRequest).filter(VacancyRequest.request_ref == first.json()["request_ref"]).one()
    row.created_at = datetime.now(timezone.utc) - PUBLIC_SUBMISSION_COOLDOWN - timedelta(seconds=1)
    db_session.flush()

    second = client.post(SUBMIT, json=_payload(campus, department, designation, location))
    assert second.status_code == 201, second.text


def test_a_different_requester_is_not_blocked_by_someone_elses_cooldown(client, intake_setup):
    # E
    campus, department, designation, _admin, location = intake_setup
    assert client.post(SUBMIT, json=_payload(campus, department, designation, location)).status_code == 201
    other = _payload(campus, department, designation, location, requester_email="arun.k@example.com",
                     requester_name="Arun Kumar")
    assert client.post(SUBMIT, json=other).status_code == 201


def test_the_per_ip_limiter_is_still_in_front_of_the_cooldown(client, intake_setup):
    # F: C1's limiter is untouched -- 5 submissions per 5 minutes per IP,
    # counted whatever the outcome, so the sixth is a limiter 429 even with
    # a fresh email each time.
    campus, department, designation, _admin, location = intake_setup
    for i in range(5):
        client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                          requester_email=f"person{i}@example.com"))
    sixth = client.post(SUBMIT, json=_payload(campus, department, designation, location,
                                              requester_email="person99@example.com"))
    assert sixth.status_code == 429
    assert "recently" not in sixth.json()["detail"]  # the limiter's message, not the cooldown's


def test_authenticated_creation_is_not_subject_to_the_public_cooldown(client, intake_setup, user_factory):
    # G: an in-app user filing two requests back to back is normal.
    campus, department, designation, _admin, location = intake_setup
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    body = {
        "campus_id": str(campus.id), "department_id": str(department.id), "designation_id": str(designation.id),
        "location_id": str(location.id), "role_category": "TEACHING", "position_title": designation.name,
        "employment_type": "FULL_TIME", "requested_count": 1, "qualification": "PhD",
        "experience_required": "3+ years", "priority": "NORMAL",
    }
    for _ in range(2):
        response = client.post("/api/v1/vacancy-requests", headers=auth_headers(client, hod), json=body)
        assert response.status_code == 201, response.text
