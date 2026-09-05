"""A hire that completes the pipeline must move the working-strength count,
and an offboarding must move it back -- for every staff category.

Found 2026-09-05 during the product-completeness audit: `create_employee`
never set `Employee.designation_id`, which is what
`sanctioned_strength.working_count_for` counts Teaching / Non-Teaching
employees by, and a Housekeeping hire never reached the housekeeping roster
that category is counted from. So the vacancy tracker never closed a gap
when a candidate joined. Production had zero employees, which is why nobody
had seen it.
"""

from app.models.employee import Employee
from app.models.enums import StaffRoleCategoryEnum
from app.models.housekeeping_staff import HousekeepingStaff
from app.services.sanctioned_strength import working_count_for
from tests.conftest import auth_headers
from tests.test_joining_onboarding import _drive_to_joining_confirmed, _mark_all_documents_received


def _drive_to_orientation_complete(client, vacancy, application):
    headers = auth_headers(client, vacancy.hr_admin)
    _drive_to_joining_confirmed(client, vacancy, application)
    assert client.post(f"/api/v1/applications/{application.id}/joining/mark-joined", headers=headers).status_code == 200
    _mark_all_documents_received(client, vacancy, application.id)
    assert (
        client.post(
            f"/api/v1/applications/{application.id}/joining/allot-department-room",
            headers=headers,
            json={"department_id": str(vacancy.department.id)},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/applications/{application.id}/joining/complete-orientation", headers=headers, json={}
        ).status_code
        == 200
    )


def _hand_over(client, vacancy, application, **extra):
    return client.post(
        f"/api/v1/applications/{application.id}/joining/hand-over-to-hod",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"hod_assigned": "Dr. Test HOD", **extra},
    )


def _offboard(client, vacancy, employee_id):
    return client.post(
        f"/api/v1/employees/{employee_id}/offboard",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"separation_type": "RESIGNED", "separation_date": "2026-12-31", "reason": "Moved away"},
    )


# ------------------------------------------------------------ Teaching / NT


def test_teaching_hire_counts_as_working_and_offboarding_releases_it(
    client, published_vacancy_factory, application_factory, designation_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    designation = designation_factory(department=vacancy.department, name="Assistant Professor")
    vacancy.vacancy_request.designation_id = designation.id
    db_session.flush()
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    before = working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id)
    assert before == 0

    response = _hand_over(client, vacancy, application)
    assert response.status_code == 200, response.text
    assert response.json()["designation_id"] == str(designation.id)
    assert working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id) == 1

    assert _offboard(client, vacancy, response.json()["id"]).status_code == 200
    assert working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id) == 0


def test_designation_is_matched_by_name_when_the_vacancy_has_none(
    client, published_vacancy_factory, application_factory, designation_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1, role_category=StaffRoleCategoryEnum.NON_TEACHING)
    assert vacancy.vacancy_request.designation_id is None
    designation = designation_factory(
        category=StaffRoleCategoryEnum.NON_TEACHING, department=vacancy.department, name="Lab Assistant"
    )
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application, designation="lab assistant")
    assert response.status_code == 200, response.text
    assert response.json()["designation_id"] == str(designation.id)
    assert working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id) == 1


def test_no_matching_designation_still_creates_the_employee(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application, designation="Something Not In The Master")
    assert response.status_code == 200, response.text
    assert response.json()["designation_id"] is None
    assert response.json()["designation"] == "Something Not In The Master"


def test_roster_fields_are_ignored_for_a_teaching_hire(
    client, published_vacancy_factory, application_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application, bio_id="BIO-1", shift="MORNING")
    assert response.status_code == 200, response.text
    assert db_session.query(HousekeepingStaff).count() == 0


# --------------------------------------------------------------- Housekeeping


def _housekeeping_vacancy(published_vacancy_factory, designation_factory, location_factory, db_session, *, location=True):
    vacancy = published_vacancy_factory(slot_count=1, role_category=StaffRoleCategoryEnum.HOUSEKEEPING)
    designation = designation_factory(
        category=StaffRoleCategoryEnum.HOUSEKEEPING, department=vacancy.department, name="Housekeeping Staff"
    )
    vacancy.vacancy_request.designation_id = designation.id
    loc = location_factory(vacancy.campus.code, name="Main Block")
    if location:
        vacancy.vacancy_request.location_id = loc.id
    db_session.flush()
    return vacancy, designation, loc


def test_housekeeping_hand_over_refuses_without_roster_details_and_writes_nothing(
    client, published_vacancy_factory, application_factory, designation_factory, location_factory, db_session
):
    vacancy, designation, location = _housekeeping_vacancy(
        published_vacancy_factory, designation_factory, location_factory, db_session
    )
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application)
    assert response.status_code == 422
    assert "bio_id and shift" in response.json()["detail"]

    only_shift = _hand_over(client, vacancy, application, shift="MORNING")
    assert only_shift.status_code == 422
    assert "bio_id" in only_shift.json()["detail"]

    assert db_session.query(Employee).filter(Employee.application_id == application.id).count() == 0
    assert db_session.query(HousekeepingStaff).count() == 0
    detail = client.get(f"/api/v1/applications/{application.id}", headers=auth_headers(client, vacancy.hr_admin))
    assert detail.json()["status"] == "ORIENTATION_COMPLETE"


def test_housekeeping_hire_lands_on_the_roster_and_counts_as_working(
    client, published_vacancy_factory, application_factory, designation_factory, location_factory, db_session
):
    vacancy, designation, location = _housekeeping_vacancy(
        published_vacancy_factory, designation_factory, location_factory, db_session
    )
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    def working():
        return working_count_for(
            db_session,
            department_id=vacancy.department.id,
            designation_id=designation.id,
            category=StaffRoleCategoryEnum.HOUSEKEEPING,
            location_id=location.id,
        )

    assert working() == 0
    response = _hand_over(client, vacancy, application, bio_id="BIO-7781", shift="NIGHT", supervisor="Mr. Kumar")
    assert response.status_code == 200, response.text
    employee_id = response.json()["id"]

    roster_row = db_session.query(HousekeepingStaff).one()
    assert roster_row.employee_id is not None and str(roster_row.employee_id) == employee_id
    assert roster_row.bio_id == "BIO-7781"
    assert roster_row.shift.value == "NIGHT"
    assert roster_row.supervisor == "Mr. Kumar"
    assert roster_row.location_id == location.id  # defaulted from the vacancy request
    assert roster_row.campus_id == vacancy.campus.id
    assert roster_row.name == application.candidate.full_name
    assert roster_row.is_active is True
    assert working() == 1

    listed = client.get(
        f"/api/v1/housekeeping-staff?campus_id={vacancy.campus.id}", headers=auth_headers(client, vacancy.hr_admin)
    ).json()["items"]
    assert [row["employee_id"] for row in listed] == [employee_id]

    assert _offboard(client, vacancy, employee_id).status_code == 200
    db_session.refresh(roster_row)
    assert roster_row.is_active is False
    assert working() == 0


def test_housekeeping_hand_over_takes_an_explicit_location_when_the_vacancy_has_none(
    client, published_vacancy_factory, application_factory, designation_factory, location_factory, db_session
):
    vacancy, designation, location = _housekeeping_vacancy(
        published_vacancy_factory, designation_factory, location_factory, db_session, location=False
    )
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    without = _hand_over(client, vacancy, application, bio_id="BIO-1", shift="MORNING")
    assert without.status_code == 422
    assert "location" in without.json()["detail"]

    other_campus_location = location_factory("SCAD")
    wrong = _hand_over(
        client, vacancy, application, bio_id="BIO-1", shift="MORNING", location_id=str(other_campus_location.id)
    )
    assert wrong.status_code == 400

    ok = _hand_over(client, vacancy, application, bio_id="BIO-1", shift="MORNING", location_id=str(location.id))
    assert ok.status_code == 200, ok.text
    assert db_session.query(HousekeepingStaff).one().location_id == location.id


def test_housekeeping_hand_over_refuses_a_duplicate_bio_id(
    client,
    published_vacancy_factory,
    application_factory,
    designation_factory,
    location_factory,
    housekeeping_staff_factory,
    db_session,
):
    vacancy, designation, location = _housekeeping_vacancy(
        published_vacancy_factory, designation_factory, location_factory, db_session
    )
    housekeeping_staff_factory(
        campus=vacancy.campus, designation=designation, location=location, created_by=vacancy.hr_admin, bio_id="BIO-DUP"
    )
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application, bio_id="BIO-DUP", shift="MORNING")
    assert response.status_code == 409
    assert db_session.query(Employee).filter(Employee.application_id == application.id).count() == 0
    assert db_session.query(HousekeepingStaff).count() == 1


def test_housekeeping_hand_over_refuses_a_non_housekeeping_designation(
    client, published_vacancy_factory, application_factory, designation_factory, location_factory, db_session
):
    vacancy = published_vacancy_factory(slot_count=1, role_category=StaffRoleCategoryEnum.HOUSEKEEPING)
    teaching = designation_factory(department=vacancy.department, name="Professor")
    vacancy.vacancy_request.designation_id = teaching.id
    vacancy.vacancy_request.location_id = location_factory(vacancy.campus.code).id
    db_session.flush()
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    _drive_to_orientation_complete(client, vacancy, application)

    response = _hand_over(client, vacancy, application, bio_id="BIO-1", shift="MORNING")
    assert response.status_code == 422
    assert "HOUSEKEEPING" in response.json()["detail"]
