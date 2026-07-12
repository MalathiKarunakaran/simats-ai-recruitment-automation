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

import json
import os
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import generate_opaque_token, hash_opaque_token, hash_password, password_reset_expiry
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.application import Application
from app.models.auth_token import PasswordResetToken
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.department import Department
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import vacancy_workflow
from app.services.ai_client import get_ai_client
from app.services.storage import get_minio_client
from app.services.vector_store import get_chroma_collection

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


class _FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeMessage:
    def __init__(self, content):
        self.content = content


def _default_ai_response(kwargs: dict) -> _FakeMessage:
    """Canned structured-JSON responses, dispatched by which JSON schema was
    requested -- mirrors app.services.ai_client's three schemas without
    importing them directly (keeps this fixture decoupled from ai_client's
    internals)."""
    schema = kwargs.get("output_config", {}).get("format", {}).get("schema", {})
    properties = schema.get("properties", {})

    if "role_overview" in properties:
        payload = {
            "role_overview": "Test role overview for a faculty position.",
            "responsibilities": ["Teach undergraduate courses.", "Mentor students."],
            "required_qualifications": ["PhD in a relevant field."],
            "preferred_skills": ["Research publications.", "Industry experience."],
            "application_process": "Apply online via the SIMATS careers portal.",
        }
    elif "eligibility_score" in properties:
        payload = {
            "eligibility_score": 82.5,
            "skill_match_pct": 75.0,
            "qualification_match_pct": 90.0,
            "experience_match_pct": 80.0,
            "publication_count": 3,
            "overall_recruitment_score": 81.0,
            "rationale": "Strong candidate with relevant qualifications and experience.",
            "extracted_skills": ["Python", "Teaching", "Research"],
            "extracted_qualification": "PhD in Computer Science",
            "extracted_experience_years": 5.0,
            "missing_required_fields": [],
        }
    elif "questions" in properties:
        payload = {
            "questions": [
                {"category": "Technical", "question": "Describe a project you led."},
                {"category": "Behavioral", "question": "How do you handle disagreement in a team?"},
            ]
        }
    else:
        payload = {}
    return _FakeMessage(content=[_FakeTextBlock(json.dumps(payload))])


class FakeAnthropicClient:
    """Fake for app.services.ai_client.get_ai_client. `response_provider`
    defaults to _default_ai_response; tests that need to exercise the
    exception->HTTP mapping in ai_client._call swap in a provider (or a
    `.messages.create` override) that raises a real `anthropic.*Error`."""

    def __init__(self, response_provider=_default_ai_response):
        self.response_provider = response_provider
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        return self.response_provider(kwargs)


class _FakeMinioResponse:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class FakeMinioClient:
    """In-memory fake for app.services.storage.get_minio_client."""

    def __init__(self):
        self._buckets: set[str] = set()
        self._objects: dict[tuple[str, str], bytes] = {}

    def bucket_exists(self, bucket: str) -> bool:
        return bucket in self._buckets

    def make_bucket(self, bucket: str) -> None:
        self._buckets.add(bucket)

    def put_object(self, bucket: str, object_name: str, data, length: int, content_type: str | None = None):
        self._objects[(bucket, object_name)] = data.read()

    def get_object(self, bucket: str, object_name: str) -> _FakeMinioResponse:
        return _FakeMinioResponse(self._objects[(bucket, object_name)])


class FakeChromaCollection:
    """In-memory fake for app.services.vector_store.get_chroma_collection.
    Deterministic "distance": 0.0 for an exact document match, 0.5 otherwise
    -- enough to exercise duplicate-detection and similarity-scoring code
    paths without a real embedding model."""

    def __init__(self):
        self._docs: dict[str, tuple[str, dict]] = {}

    def upsert(self, ids, documents, metadatas):
        for doc_id, document, metadata in zip(ids, documents, metadatas):
            self._docs[doc_id] = (document, metadata)

    def query(self, query_texts, n_results: int = 5, where: dict | None = None):
        query_text = query_texts[0]
        candidates = list(self._docs.items())
        if where:
            candidates = [
                (doc_id, value)
                for doc_id, value in candidates
                if value[1].get("candidate_id") == where.get("candidate_id")
            ]

        def _distance(item):
            document = item[1][0]
            return 0.0 if document == query_text else 0.5

        candidates.sort(key=_distance)
        candidates = candidates[:n_results]
        return {
            "ids": [[doc_id for doc_id, _ in candidates]],
            "distances": [[_distance((doc_id, value)) for doc_id, value in candidates]],
        }


def build_test_pdf(text: str = "") -> bytes:
    """Builds a minimal, real, pypdf-parseable PDF containing `text` (or a
    blank page if text is empty -- used to exercise the
    resume-text-too-short incomplete-profile path)."""
    import io

    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)

    if text:
        font = DictionaryObject()
        font[NameObject("/Type")] = NameObject("/Font")
        font[NameObject("/Subtype")] = NameObject("/Type1")
        font[NameObject("/BaseFont")] = NameObject("/Helvetica")
        font_ref = writer._add_object(font)

        if "/Resources" not in page:
            page[NameObject("/Resources")] = DictionaryObject()
        font_dict = DictionaryObject()
        font_dict[NameObject("/F1")] = font_ref
        page["/Resources"][NameObject("/Font")] = font_dict

        escaped = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        content = f"BT /F1 24 Tf 72 700 Td ({escaped}) Tj ET".encode()
        stream = DecodedStreamObject()
        stream.set_data(content)
        page[NameObject("/Contents")] = writer._add_object(stream)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@pytest.fixture()
def fake_ai_client():
    return FakeAnthropicClient()


@pytest.fixture()
def fake_minio_client():
    return FakeMinioClient()


@pytest.fixture()
def fake_chroma_collection():
    return FakeChromaCollection()


@pytest.fixture()
def client(db_session, fake_ai_client, fake_minio_client, fake_chroma_collection):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_ai_client] = lambda: fake_ai_client
    app.dependency_overrides[get_minio_client] = lambda: fake_minio_client
    app.dependency_overrides[get_chroma_collection] = lambda: fake_chroma_collection
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


@pytest.fixture()
def department_factory(db_session, campus_factory):
    def _make(campus_code: str, name: str | None = None) -> Department:
        campus = campus_factory(campus_code)
        department = Department(campus_id=campus.id, name=name or f"Dept-{uuid.uuid4().hex[:8]}")
        db_session.add(department)
        db_session.flush()
        return department

    return _make


@pytest.fixture()
def candidate_factory(db_session):
    counter = {"n": 0}

    def _make(email: str | None = None, full_name: str | None = None, phone_number: str | None = None) -> Candidate:
        counter["n"] += 1
        candidate = Candidate(
            full_name=full_name or f"Candidate {counter['n']}",
            email=email or f"candidate{counter['n']}.{uuid.uuid4().hex[:8]}@example.com",
            phone_number=phone_number,
        )
        db_session.add(candidate)
        db_session.flush()
        return candidate

    return _make


@pytest.fixture()
def application_factory(db_session, candidate_factory):
    def _make(job_posting, recorded_by: User, candidate: Candidate | None = None) -> Application:
        candidate = candidate or candidate_factory()
        application = Application(
            candidate_id=candidate.id,
            job_posting_id=job_posting.id,
            campus_id=job_posting.campus_id,
            applied_at=datetime.now(timezone.utc),
            recorded_by_id=recorded_by.id,
        )
        db_session.add(application)
        db_session.flush()
        return application

    return _make


@pytest.fixture()
def published_vacancy_factory(db_session, campus_factory, department_factory, user_factory):
    """Creates a VacancyRequest and drives it all the way through
    submit -> dean-approve -> hr-approve (creating N HiringSlots) -> publish
    (creating a JobPosting), using the real vacancy_workflow service --
    exactly what the API does -- so tests exercise the same code path.
    Returns a SimpleNamespace with all the created entities/actors."""

    def _make(campus_code: str = "SSE", slot_count: int = 2):
        campus = campus_factory(campus_code)
        department = department_factory(campus_code)
        hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code=campus_code)
        dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
        hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
        recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code=campus_code)

        vacancy_request = VacancyRequest(
            campus_id=campus.id,
            department_id=department.id,
            role_category=StaffRoleCategoryEnum.TEACHING,
            position_title=f"Position-{uuid.uuid4().hex[:8]}",
            employment_type=EmploymentTypeEnum.FULL_TIME,
            requested_count=slot_count,
            qualification="Test qualification",
            experience_required="Test experience",
            requested_by_id=hod.id,
        )
        db_session.add(vacancy_request)
        db_session.flush()

        vacancy_workflow.submit(db_session, vacancy_request, hod, None)
        vacancy_workflow.dean_approve(db_session, vacancy_request, dean, None)
        approved_vacancy = vacancy_workflow.hr_approve(db_session, vacancy_request, hr_admin, None)
        job_posting = vacancy_workflow.publish(db_session, vacancy_request, approved_vacancy, hr_admin, None)
        db_session.flush()

        return SimpleNamespace(
            campus=campus,
            department=department,
            vacancy_request=vacancy_request,
            approved_vacancy=approved_vacancy,
            job_posting=job_posting,
            hod=hod,
            dean=dean,
            hr_admin=hr_admin,
            recruitment_officer=recruitment_officer,
        )

    return _make
