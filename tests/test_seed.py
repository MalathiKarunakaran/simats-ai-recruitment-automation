"""Exercises the seed script's idempotent upsert helpers directly against the
test DB session -- NOT by running `python -m app.db.seed`, which is bound to
the real dev database via its own SessionLocal and would pollute it."""

from app.db.seed import _get_or_create_campus, _get_or_create_user, _seed_scenario_full_happy_path
from app.models.campus import Campus
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.models.vacancy_request import VacancyRequest


def test_phase2_happy_path_scenario_is_idempotent_and_ends_closed(
    db_session, campus_factory, department_factory, user_factory
):
    campus = campus_factory("SSE")
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    for _ in range(2):
        _seed_scenario_full_happy_path(
            db_session,
            campus=campus,
            department=department,
            hod=hod,
            dean=dean,
            hr_admin=hr_admin,
            recruitment_officer=officer,
        )

    matches = (
        db_session.query(VacancyRequest)
        .filter(VacancyRequest.campus_id == campus.id, VacancyRequest.position_title == "Assistant Professor")
        .all()
    )
    assert len(matches) == 1
    assert matches[0].status.value == "CLOSED"


def test_seed_helpers_are_idempotent(db_session):
    _get_or_create_campus(db_session, "SSE")
    _get_or_create_campus(db_session, "SSE")
    assert db_session.query(Campus).filter(Campus.code == "SSE").count() == 1

    campus = _get_or_create_campus(db_session, "SCAD")
    _get_or_create_user(
        db_session,
        email="idempotent@example.com",
        password="pass123456",
        full_name="Idempotent User",
        role=UserRoleEnum.HR_ADMIN,
        campus=campus,
    )
    _get_or_create_user(
        db_session,
        email="idempotent@example.com",
        password="pass123456",
        full_name="Idempotent User",
        role=UserRoleEnum.HR_ADMIN,
        campus=campus,
    )
    assert db_session.query(User).filter(User.email == "idempotent@example.com").count() == 1
