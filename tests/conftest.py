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
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import (
    generate_opaque_token,
    hash_opaque_token,
    hash_password,
    otp_expiry,
    password_reset_expiry,
)
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.application import Application
from app.models.auth_token import LoginOtp, PasswordResetToken
from app.models.campus import Campus
from app.models.candidate import Candidate
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant
from app.models.department import Department
from app.models.designation import Designation
from app.models.enums import (
    ApplicationStatusEnum,
    CoordinatorCapabilityEnum,
    EmploymentTypeEnum,
    HousekeepingShiftEnum,
    JoiningDocumentStatusEnum,
    OfferStatusEnum,
    PermissionEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.housekeeping_staff import HousekeepingStaff
from app.models.joining import JoiningDocument
from app.models.location import Location
from app.models.offer import Offer
from app.models.sanctioned_strength import SanctionedStrength
from app.models.user import User
from app.models.user_department_scope import user_department_scope
from app.models.user_permission_grant import UserPermissionGrant
from app.models.vacancy_request import VacancyRequest
from app.services import joining as joining_service
from app.services import pipeline, vacancy_workflow
from app.services.ai_client import get_ai_client, get_openai_client
from app.services.permissions import seed_default_permissions
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


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """app.core.rate_limit's buckets are plain module-level state, and every
    TestClient request shares the same synthetic client IP -- without this,
    unrelated tests exhaust the /auth/login rate limit via the auth_headers()
    helper alone."""
    from app.core.rate_limit import reset_all

    reset_all()
    yield
    reset_all()


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


class FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class FakeToolUseBlock:
    def __init__(self, name: str, tool_input: dict, id: str | None = None):
        self.type = "tool_use"
        self.name = name
        self.input = tool_input
        self.id = id or f"toolu_{uuid.uuid4().hex[:16]}"


class FakeMessage:
    def __init__(self, content, stop_reason: str = "end_turn"):
        self.content = content
        self.stop_reason = stop_reason


# Old underscored names kept as aliases -- Phase 3 tests reference them directly.
_FakeTextBlock = FakeTextBlock
_FakeMessage = FakeMessage


def _default_ai_response(kwargs: dict) -> FakeMessage:
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
    return FakeMessage(content=[FakeTextBlock(json.dumps(payload))])


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


class FakeOpenAIFunctionCall:
    """Fake for an OpenAI tool call's nested `.function` -- `arguments` is a
    JSON-encoded *string*, matching the real API (callers must json.loads it
    themselves, unlike Anthropic's already-parsed tool_use.input dict)."""

    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments


class FakeOpenAIToolCall:
    """Fake for one entry of `response.choices[0].message.tool_calls` --
    used by app/services/hermes.py's Module 14 tool-calling loop tests.
    `arguments` is given here as a plain dict and JSON-encoded internally."""

    def __init__(self, name: str, arguments: dict, id: str | None = None):
        self.id = id or f"call_{uuid.uuid4().hex[:16]}"
        self.type = "function"
        self.function = FakeOpenAIFunctionCall(name, json.dumps(arguments))


class FakeOpenAIChoiceMessage:
    def __init__(self, content: str | None = None, tool_calls: list | None = None):
        self.content = content
        self.tool_calls = tool_calls


class FakeOpenAIChoice:
    def __init__(self, message: FakeOpenAIChoiceMessage):
        self.message = message


class FakeOpenAIResponse:
    """Takes a `FakeOpenAIChoiceMessage` directly (not a raw content string)
    so both plain-text and tool-call responses share one constructor --
    `_default_openai_response` below still builds it from a text/JSON
    string, unchanged for existing JD-gen/resume-scoring/interview-question
    callers."""

    def __init__(self, message: FakeOpenAIChoiceMessage):
        self.choices = [FakeOpenAIChoice(message)]


def _default_openai_response(kwargs: dict) -> FakeOpenAIResponse:
    """Canned structured-JSON responses, dispatched by which JSON schema was
    requested -- mirrors _default_ai_response but reads OpenAI's
    response_format={"type": "json_schema", "json_schema": {"schema": ...}}
    shape instead of Anthropic's output_config.format.schema."""
    schema = kwargs.get("response_format", {}).get("json_schema", {}).get("schema", {})
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
    return FakeOpenAIResponse(FakeOpenAIChoiceMessage(content=json.dumps(payload)))


class FakeOpenAIClient:
    """Fake for app.services.ai_client.get_openai_client. `response_provider`
    defaults to _default_openai_response; tests that need to exercise the
    exception->HTTP mapping in ai_client._call_openai swap in a provider (or
    a `.chat.completions.create` override) that raises a real
    `openai.*Error`."""

    def __init__(self, response_provider=_default_openai_response):
        self.response_provider = response_provider
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

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
    """In-memory fake for app.services.storage.get_minio_client.

    `fail_puts`, if set True, makes `bucket_exists`/`put_object` raise
    (simulating MinIO being unreachable) -- used to test the bulk-upload
    commit endpoints' storage-failure-degrades-to-warning path
    (`storage.try_upload_bulk_upload_file`), never the resume-upload path
    (which is deliberately still hard-fail-on-storage-error).
    """

    def __init__(self):
        self._buckets: set[str] = set()
        self._objects: dict[tuple[str, str], bytes] = {}
        self.fail_puts = False

    def bucket_exists(self, bucket: str) -> bool:
        if self.fail_puts:
            raise ConnectionError("simulated MinIO outage")
        return bucket in self._buckets

    def make_bucket(self, bucket: str) -> None:
        self._buckets.add(bucket)

    def put_object(self, bucket: str, object_name: str, data, length: int, content_type: str | None = None):
        if self.fail_puts:
            raise ConnectionError("simulated MinIO outage")
        self._objects[(bucket, object_name)] = data.read()

    def get_object(self, bucket: str, object_name: str) -> _FakeMinioResponse:
        return _FakeMinioResponse(self._objects[(bucket, object_name)])


class FakeN8nClient:
    """In-memory fake for app.services.n8n_client.N8nClient. `raises`, if
    given, is raised by post_webhook on every call (to simulate a webhook
    failure) instead of recording it."""

    def __init__(self, raises: Exception | None = None):
        self.raises = raises
        self.calls: list[tuple[str, dict]] = []

    def post_webhook(self, path: str, payload: dict) -> dict | None:
        if self.raises is not None:
            raise self.raises
        self.calls.append((path, payload))
        return {"status": "ok"}


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
def fake_openai_client():
    return FakeOpenAIClient()


@pytest.fixture()
def fake_minio_client():
    return FakeMinioClient()


@pytest.fixture()
def fake_chroma_collection():
    return FakeChromaCollection()


@pytest.fixture()
def client(db_session, fake_ai_client, fake_openai_client, fake_minio_client, fake_chroma_collection):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_ai_client] = lambda: fake_ai_client
    app.dependency_overrides[get_openai_client] = lambda: fake_openai_client
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
        # Mirrors POST /users's own seeding (app/api/v1/routers/users.py's
        # create_user) so a test user built directly in the DB has the same
        # default UserPermissionGrant rows a real user of that role would get
        # -- required now that Phase 2 routers gate on require_permission()
        # rather than role alone. Idempotent/no-op for SUPER_ADMIN/CANDIDATE.
        seed_default_permissions(db_session, user)
        db_session.flush()
        user.plain_password = password  # test-only convenience, not a model field
        return user

    return _make


@pytest.fixture()
def grant_coordinator_capability(db_session):
    """Directly inserts a CoordinatorCapabilityGrant row -- the RBAC tests
    that exercise the gated action groups need a coordinator who already
    holds the relevant grant, without going through the
    PUT /users/{id}/capabilities endpoint (that endpoint has its own
    dedicated tests in test_users_rbac.py)."""

    def _grant(user: User, capability: CoordinatorCapabilityEnum, granted_by: User | None = None) -> None:
        db_session.add(
            CoordinatorCapabilityGrant(
                user_id=user.id,
                capability=capability,
                granted_by_id=granted_by.id if granted_by else None,
            )
        )
        db_session.flush()

    return _grant


@pytest.fixture()
def department_scope_factory(db_session):
    """Directly inserts `user_department_scope` rows -- the plain join table
    behind GET/PUT /users/{id}/department-scope and (Phase 4 of the
    permission-matrix epic) app.core.deps.get_department_scope. Bypasses the
    PUT endpoint (which has its own dedicated tests in
    test_user_department_scope.py) since these tests only need the row to
    exist, not to exercise that endpoint's own validation."""

    def _grant(user: User, *departments: Department) -> None:
        for department in departments:
            db_session.execute(
                user_department_scope.insert().values(user_id=user.id, department_id=department.id)
            )
        db_session.flush()

    return _grant


@pytest.fixture()
def grant_permission(db_session):
    """Directly inserts a UserPermissionGrant row -- same shape as
    grant_coordinator_capability above, for tests exercising Phase 2's
    require_permission()-gated endpoints. Idempotent-ish is not needed here
    (tests build fresh users), unlike app.services.permissions.
    seed_default_permissions."""

    def _grant(user: User, permission: PermissionEnum, granted_by: User | None = None) -> None:
        db_session.add(
            UserPermissionGrant(
                user_id=user.id,
                permission=permission,
                granted_by_id=granted_by.id if granted_by else None,
            )
        )
        db_session.flush()

    return _grant


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
def login_otp_factory(db_session):
    def _make(user: User, code: str = "123456", expired: bool = False) -> str:
        row = LoginOtp(
            user_id=user.id,
            code_hash=hash_password(code),
            expires_at=otp_expiry(),
        )
        if expired:
            row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db_session.add(row)
        db_session.flush()
        return code

    return _make


@pytest.fixture()
def department_factory(db_session, campus_factory):
    def _make(
        campus_code: str,
        name: str | None = None,
        category: StaffRoleCategoryEnum | None = None,
        supported_categories: list[StaffRoleCategoryEnum] | None = None,
        code: str | None = None,
        parent_group: str | None = None,
        description: str | None = None,
        is_active: bool = True,
    ) -> Department:
        campus = campus_factory(campus_code)
        # `category=` is kept as the single-category shorthand it always was.
        # Most callers pass it only to mean "a department that holds TEACHING
        # staff", which is still exactly what a one-element
        # supported_categories says -- so they needed no edit when the column
        # went multi-valued (2026-08-28). Pass `supported_categories=` to
        # build a department that holds more than one.
        categories = supported_categories
        if categories is None and category is not None:
            categories = [category]
        department = Department(
            campus_id=campus.id,
            name=name or f"Dept-{uuid.uuid4().hex[:8]}",
            code=code,
            parent_group=parent_group,
            description=description,
            is_active=is_active,
            **({"supported_categories": categories} if categories is not None else {}),
        )
        db_session.add(department)
        db_session.flush()
        return department

    return _make


@pytest.fixture()
def designation_factory(db_session):
    counter = {"n": 0}

    def _make(
        category: StaffRoleCategoryEnum = StaffRoleCategoryEnum.TEACHING,
        name: str | None = None,
        department: Department | None = None,
    ) -> Designation:
        counter["n"] += 1
        designation = Designation(
            name=name or f"Designation-{counter['n']}-{uuid.uuid4().hex[:6]}",
            category=category,
            qualification="Test qualification",
            min_experience="1 year",
            employment_type=EmploymentTypeEnum.FULL_TIME,
        )
        if department is not None:
            designation.departments = [department]
        db_session.add(designation)
        db_session.flush()
        return designation

    return _make


@pytest.fixture()
def sanctioned_strength_factory(db_session, campus_factory):
    def _make(
        *,
        campus,
        department: Department,
        designation: Designation,
        approved_strength: int = 5,
        effective_from: date | None = None,
        is_active: bool = True,
        created_by: User,
        remarks: str | None = None,
        location_id: uuid.UUID | None = None,
    ) -> SanctionedStrength:
        row = SanctionedStrength(
            campus_id=campus.id,
            department_id=department.id,
            designation_id=designation.id,
            location_id=location_id,
            category=designation.category,
            approved_strength=approved_strength,
            effective_from=effective_from or date.today(),
            is_active=is_active,
            remarks=remarks,
            created_by_id=created_by.id,
        )
        db_session.add(row)
        db_session.flush()
        return row

    return _make


@pytest.fixture()
def location_factory(db_session, campus_factory):
    def _make(
        campus_code: str,
        name: str | None = None,
        category: StaffRoleCategoryEnum | None = None,
        block_building: str | None = None,
        floor_venue: str | None = None,
    ) -> Location:
        campus = campus_factory(campus_code)
        location = Location(
            campus_id=campus.id,
            name=name or f"Location-{uuid.uuid4().hex[:8]}",
            category=category,
            block_building=block_building,
            floor_venue=floor_venue,
        )
        db_session.add(location)
        db_session.flush()
        return location

    return _make


@pytest.fixture()
def housekeeping_staff_factory(db_session):
    counter = {"n": 0}

    def _make(
        *,
        campus,
        designation: Designation,
        location: Location,
        created_by: User,
        bio_id: str | None = None,
        name: str | None = None,
        shift: HousekeepingShiftEnum = HousekeepingShiftEnum.MORNING,
        block: str | None = None,
        floor_venue: str | None = None,
        supervisor: str | None = None,
        is_active: bool = True,
    ) -> HousekeepingStaff:
        counter["n"] += 1
        row = HousekeepingStaff(
            campus_id=campus.id,
            bio_id=bio_id or f"BIO-{counter['n']}-{uuid.uuid4().hex[:6]}",
            name=name or f"Housekeeping Staff {counter['n']}",
            designation_id=designation.id,
            location_id=location.id,
            block=block,
            floor_venue=floor_venue,
            shift=shift,
            supervisor=supervisor,
            is_active=is_active,
            created_by_id=created_by.id,
        )
        db_session.add(row)
        db_session.flush()
        return row

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
            role_category=job_posting.role_category,
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

    def _make(
        campus_code: str = "SSE",
        slot_count: int = 2,
        role_category: StaffRoleCategoryEnum = StaffRoleCategoryEnum.TEACHING,
        qualification: str = "Test qualification",
    ):
        campus = campus_factory(campus_code)
        department = department_factory(campus_code)
        hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code=campus_code)
        dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
        hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
        recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code=campus_code)

        vacancy_request = VacancyRequest(
            campus_id=campus.id,
            department_id=department.id,
            role_category=role_category,
            position_title=f"Position-{uuid.uuid4().hex[:8]}",
            employment_type=EmploymentTypeEnum.FULL_TIME,
            requested_count=slot_count,
            qualification=qualification,
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


@pytest.fixture()
def hired_employee_factory(db_session, candidate_factory):
    """Drives one Application against an already-published vacancy all the
    way to HANDED_OVER_TO_HOD, mirroring app/db/seed.py's
    _seed_scenario_full_happy_path candidate-A sequence exactly (same
    service calls, same status order) but with `applied_at`/`joining_date`
    exposed as parameters -- needed for exact time-to-hire assertions in
    the Phase 5 dashboard/report tests."""

    def _make(vacancy, *, applied_at: datetime | None = None, joining_date: date | None = None):
        applied_at = applied_at or datetime.now(timezone.utc)
        joining_date = joining_date or date.today()
        actor = vacancy.hr_admin

        candidate = candidate_factory()
        application = Application(
            candidate_id=candidate.id,
            job_posting_id=vacancy.job_posting.id,
            campus_id=vacancy.job_posting.campus_id,
            role_category=vacancy.job_posting.role_category,
            applied_at=applied_at,
            recorded_by_id=vacancy.recruitment_officer.id,
        )
        db_session.add(application)
        db_session.flush()

        for target in (
            ApplicationStatusEnum.SCREENING,
            ApplicationStatusEnum.CALLED_FOR_INTERVIEW,
            ApplicationStatusEnum.INTERVIEWED,
        ):
            pipeline.transition_application_status(db_session, application=application, new_status=target, actor=actor)
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.SELECTED, actor=actor
        )

        offer = Offer(
            application_id=application.id, offered_by_id=actor.id, salary_amount=75000, joining_date=joining_date
        )
        db_session.add(offer)
        db_session.flush()
        offer.status = OfferStatusEnum.SENT
        offer.sent_at = datetime.now(timezone.utc)
        pipeline.advance_if_behind(
            db_session, application=application, target_status=ApplicationStatusEnum.OFFER_SENT, actor=actor
        )
        offer.status = OfferStatusEnum.ACCEPTED
        offer.responded_at = datetime.now(timezone.utc)
        pipeline.advance_if_behind(
            db_session, application=application, target_status=ApplicationStatusEnum.OFFER_ACCEPTED, actor=actor
        )
        pipeline.advance_if_behind(
            db_session, application=application, target_status=ApplicationStatusEnum.JOINING_CONFIRMED, actor=actor
        )

        joining_record = joining_service.initialize_joining_checklist(
            db_session, application=application, joining_date=joining_date, actor=actor
        )
        db_session.flush()
        for doc in db_session.query(JoiningDocument).filter(JoiningDocument.application_id == application.id).all():
            doc.status = JoiningDocumentStatusEnum.RECEIVED
            doc.received_at = datetime.now(timezone.utc)
        db_session.flush()

        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.JOINED, actor=actor
        )
        joining_record.actual_joining_date = joining_date
        joining_service.complete_onboarding(
            db_session, application=application, joining_record=joining_record, actor=actor
        )
        joining_service.allot_department_room(
            db_session, application=application, department_id=vacancy.department.id, room_allotted="R-101", actor=actor
        )
        pipeline.transition_application_status(
            db_session,
            application=application,
            new_status=ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED,
            actor=actor,
        )
        joining_service.complete_orientation(
            db_session, application=application, orientation_date=joining_date, actor=actor
        )
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.ORIENTATION_COMPLETE, actor=actor
        )
        application.hod_assigned = vacancy.hod.full_name
        employee = joining_service.create_employee(
            db_session, application=application, joining_record=joining_record, designation=None, actor=actor
        )
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.HANDED_OVER_TO_HOD, actor=actor
        )

        return SimpleNamespace(application=application, offer=offer, joining_record=joining_record, employee=employee)

    return _make
