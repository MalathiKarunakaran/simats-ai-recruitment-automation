"""Test fixtures.

Uses a dedicated Postgres database (TEST_DATABASE_URL, defaulting to
`..._test` alongside the dev DB on the same server) with tables created via
Base.metadata.create_all() rather than a full `alembic upgrade head` per run
-- a deliberate Phase 1 speed trade-off, documented in the README, worth
revisiting once migrations get more complex.

Each test runs inside an outer transaction + SAVEPOINT that's rolled back at
teardown (the standard SQLAlchemy "join a session into an external
transaction" recipe), so router code calling `db.commit()` behaves normally
within a test while nothing is ever persisted between tests.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import generate_opaque_token, hash_opaque_token, hash_password, password_reset_expiry
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.auth_token import PasswordResetToken
from app.models.campus import Campus
from app.models.enums import UserRoleEnum
from app.models.user import User

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    settings.DATABASE_URL.rsplit("/", 1)[0] + "/simats_recruitment_test",
)

engine = create_engine(TEST_DATABASE_URL)
TestingSessionLocal = sessionmaker(bind=engine)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    connection = engine.connect()
    outer_transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):
        nonlocal nested
        if not nested.is_active:
            nested = connection.begin_nested()

    yield session

    session.close()
    outer_transaction.rollback()
    connection.close()


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def campus_factory(db_session):
    def _make(code: str, name: str | None = None) -> Campus:
        campus = db_session.query(Campus).filter(Campus.code == code).one_or_none()
        if campus is None:
            campus = Campus(code=code, name=name or f"Campus {code}")
            db_session.add(campus)
            db_session.flush()
        return campus

    return _make


DEFAULT_TEST_PASSWORD = "TestPass123!"


@pytest.fixture()
def user_factory(db_session, campus_factory):
    counter = {"n": 0}

    def _make(
        role: UserRoleEnum,
        campus_code: str | None = None,
        password: str = DEFAULT_TEST_PASSWORD,
        is_active: bool = True,
    ) -> User:
        counter["n"] += 1
        campus = campus_factory(campus_code) if campus_code else None
        user = User(
            email=f"user{counter['n']}.{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password(password),
            full_name=f"Test User {counter['n']}",
            role=role,
            campus_id=campus.id if campus else None,
            is_active=is_active,
        )
        db_session.add(user)
        db_session.flush()
        user.plain_password = password  # test-only convenience, not a model field
        return user

    return _make


def auth_headers(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        data={"username": user.email, "password": user.plain_password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture()
def password_reset_token_factory(db_session):
    def _make(user: User) -> str:
        raw_token = generate_opaque_token()
        db_session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_opaque_token(raw_token),
                expires_at=password_reset_expiry(),
            )
        )
        db_session.flush()
        return raw_token

    return _make
