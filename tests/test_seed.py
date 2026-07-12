"""Exercises the seed script's idempotent upsert helpers directly against the
test DB session -- NOT by running `python -m app.db.seed`, which is bound to
the real dev database via its own SessionLocal and would pollute it."""

from app.db.seed import _get_or_create_campus, _get_or_create_user
from app.models.campus import Campus
from app.models.enums import UserRoleEnum
from app.models.user import User


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
