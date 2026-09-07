"""The public careers pages and apply flow (2026-09-07).

Like the QR intake's tests, most of these are about what the surface REFUSES:
it lists only what is genuinely open, it hands out no internal ids, it takes
no application against a closed/paused/expired posting, no second one from
the same address, no non-PDF, no bot submission, and no flood from one IP.
The happy path must also leave exactly the rows a staff-recorded application
would -- that is the whole point of it.
"""

from datetime import date, timedelta

import pytest

from app.core import rate_limit
from app.core.config import settings
from app.models.application import Application
from app.models.audit_log import AuditLog
from app.models.candidate import Candidate
from app.models.enums import ApplicationStatusEnum, JobPostingStatusEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.notification import Notification
from app.services import vacancy_workflow

from tests.conftest import build_test_pdf

LIST = "/api/v1/public/careers/postings"


def detail_url(slug: str) -> str:
    return f"{LIST}/{slug}"


def apply_url(slug: str) -> str:
    return f"{LIST}/{slug}/apply"


@pytest.fixture(autouse=True)
def _reset_limits():
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()


@pytest.fixture()
def super_admin(user_factory):
    """The intake account a public application is attributed to (no
    QR_INTAKE_USER_EMAIL is configured in tests, so the fallback applies)."""
    return user_factory(UserRoleEnum.SUPER_ADMIN)


def _form(**overrides):
    fields = {"full_name": "Asha Candidate", "email": "asha@example.com", "phone_number": "9876543210"}
    fields.update(overrides)
    return fields


def _pdf(name: str = "resume.pdf", data: bytes | None = None, content_type: str = "application/pdf"):
    return {"resume": (name, data if data is not None else build_test_pdf("Asha Candidate, PhD"), content_type)}


# --- listing -----------------------------------------------------------------


def test_list_shows_only_postings_accepting_applications(client, db_session, published_vacancy_factory):
    open_one = published_vacancy_factory(campus_code="SSE")
    paused = published_vacancy_factory(campus_code="SSE")
    paused.job_posting.status = JobPostingStatusEnum.PAUSED
    expired = published_vacancy_factory(campus_code="SSE")
    expired.job_posting.apply_deadline = date.today() - timedelta(days=1)
    closed = published_vacancy_factory(campus_code="SSE")
    vacancy_workflow.close(db_session, closed.vacancy_request, closed.approved_vacancy, closed.job_posting, closed.hr_admin, None)
    db_session.flush()

    response = client.get(LIST)

    assert response.status_code == 200
    body = response.json()
    slugs = {item["public_apply_slug"] for item in body["items"]}
    assert slugs == {open_one.job_posting.public_apply_slug}
    assert body["total"] == 1


def test_list_item_carries_the_ad_and_no_internal_ids(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=3)

    item = client.get(LIST).json()["items"][0]

    assert item["title"] == vacancy.vacancy_request.position_title
    assert item["campus_code"] == "SSE"
    assert item["department_name"] == vacancy.department.name
    assert item["positions_open"] == 3
    assert item["posting_number"] == vacancy.job_posting.posting_number
    for internal in ("id", "campus_id", "department_id", "approved_vacancy_id", "vacancy_request_id"):
        assert internal not in item


def test_list_filters_by_campus_category_and_title(client, published_vacancy_factory):
    sse_teaching = published_vacancy_factory(campus_code="SSE", role_category=StaffRoleCategoryEnum.TEACHING)
    sclas_nt = published_vacancy_factory(campus_code="SCLAS", role_category=StaffRoleCategoryEnum.NON_TEACHING)

    by_campus = client.get(LIST, params={"campus": "sclas"}).json()
    assert [i["public_apply_slug"] for i in by_campus["items"]] == [sclas_nt.job_posting.public_apply_slug]

    by_category = client.get(LIST, params={"role_category": "TEACHING"}).json()
    assert [i["public_apply_slug"] for i in by_category["items"]] == [sse_teaching.job_posting.public_apply_slug]

    by_title = client.get(LIST, params={"q": sse_teaching.vacancy_request.position_title[-6:]}).json()
    assert [i["public_apply_slug"] for i in by_title["items"]] == [sse_teaching.job_posting.public_apply_slug]

    assert client.get(LIST, params={"q": "no-such-title"}).json() == {"items": [], "total": 0}


def test_list_needs_no_authentication_and_is_empty_without_postings(client):
    response = client.get(LIST)
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


# --- detail ------------------------------------------------------------------


def test_detail_returns_the_ad_body_and_accepting_flag(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE")
    vacancy.job_posting.ad_body = "Teach. Research. Publish."
    vacancy.job_posting.contact_email = "hr@example.edu"

    body = client.get(detail_url(vacancy.job_posting.public_apply_slug)).json()

    assert body["ad_body"] == "Teach. Research. Publish."
    assert body["contact_email"] == "hr@example.edu"
    assert body["status"] == "PUBLISHED"
    assert body["is_accepting_applications"] is True
    assert "id" not in body


def test_detail_of_a_closed_posting_still_resolves_but_says_closed(client, db_session, published_vacancy_factory):
    """A slug on a printed poster must not turn into a 404 when the posting
    closes; the page says it has closed."""
    vacancy = published_vacancy_factory(campus_code="SSE")
    vacancy_workflow.close(db_session, vacancy.vacancy_request, vacancy.approved_vacancy, vacancy.job_posting, vacancy.hr_admin, None)
    db_session.flush()

    body = client.get(detail_url(vacancy.job_posting.public_apply_slug)).json()

    assert body["status"] == "CLOSED"
    assert body["is_accepting_applications"] is False


def test_detail_unknown_slug_is_404(client):
    assert client.get(detail_url("never-existed-0000")).status_code == 404


# --- apply: the happy path ---------------------------------------------------


def test_apply_creates_candidate_resume_application_audit_and_notification(
    client, db_session, published_vacancy_factory, super_admin, fake_minio_client
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    slug = vacancy.job_posting.public_apply_slug

    response = client.post(apply_url(slug), data=_form(), files=_pdf())

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["posting_number"] == vacancy.job_posting.posting_number
    assert body["title"] == vacancy.vacancy_request.position_title
    assert body["applicant_name"] == "Asha Candidate"
    assert set(body) == {"posting_number", "title", "applicant_name", "applied_at"}

    candidate = db_session.query(Candidate).filter(Candidate.email == "asha@example.com").one()
    assert candidate.source == "Careers Page"
    assert candidate.phone_number == "9876543210"
    assert candidate.resume_storage_key == f"{candidate.id}/resume.pdf"
    assert (settings.MINIO_BUCKET_RESUMES, candidate.resume_storage_key) in fake_minio_client._objects

    application = db_session.query(Application).filter(Application.candidate_id == candidate.id).one()
    assert application.job_posting_id == vacancy.job_posting.id
    assert application.status == ApplicationStatusEnum.APPLIED
    assert application.campus_id == vacancy.job_posting.campus_id
    assert application.role_category == vacancy.job_posting.role_category
    # Owned by the intake account, not by any staff member who happened to exist.
    assert application.recorded_by_id == super_admin.id

    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "Application", AuditLog.entity_id == application.id, AuditLog.action == "CREATE")
        .one()
    )
    assert audit.after_state["source"] == "Careers Page"

    recipients = {
        n.recipient_user_id
        for n in db_session.query(Notification).filter(Notification.notification_type == "APPLICATION_RECEIVED").all()
    }
    assert vacancy.recruitment_officer.id in recipients
    assert vacancy.hr_admin.id in recipients


def test_apply_reuses_an_existing_candidate_by_email_case_insensitively(
    client, db_session, published_vacancy_factory, super_admin, candidate_factory
):
    """HR typed the candidate in first; the same person applying online must
    become a second application on the SAME candidate, not a duplicate."""
    vacancy = published_vacancy_factory(campus_code="SSE")
    existing = candidate_factory(email="Asha@Example.com", full_name="Asha K", phone_number=None)

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=_pdf())

    assert response.status_code == 201, response.text
    assert db_session.query(Candidate).filter(Candidate.email.ilike("asha@example.com")).count() == 1
    db_session.refresh(existing)
    assert existing.full_name == "Asha K"  # HR's record is not overwritten
    assert existing.phone_number == "9876543210"  # but a blank is filled in
    assert existing.resume_storage_key == f"{existing.id}/resume.pdf"
    assert db_session.query(Application).filter(Application.candidate_id == existing.id).count() == 1


def test_apply_to_two_postings_is_one_candidate_with_two_applications(
    client, db_session, published_vacancy_factory, super_admin
):
    first = published_vacancy_factory(campus_code="SSE")
    second = published_vacancy_factory(campus_code="SCLAS")

    assert client.post(apply_url(first.job_posting.public_apply_slug), data=_form(), files=_pdf()).status_code == 201
    assert client.post(apply_url(second.job_posting.public_apply_slug), data=_form(), files=_pdf()).status_code == 201

    candidate = db_session.query(Candidate).filter(Candidate.email == "asha@example.com").one()
    assert db_session.query(Application).filter(Application.candidate_id == candidate.id).count() == 2


def test_apply_runs_the_same_qualification_check_as_staff_entry(
    client, db_session, published_vacancy_factory, super_admin
):
    """The non-blocking vacancy-side check `applications.create_application`
    runs must run here too, or a public application would skip a flag HR
    relies on. A Teaching vacancy declaring a PhD with no active rule
    permitting it is the flagged case. Flag set, application still created."""
    vacancy = published_vacancy_factory(
        campus_code="SSE", role_category=StaffRoleCategoryEnum.TEACHING, qualification="Ph.D. in Computer Science"
    )

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=_pdf())

    assert response.status_code == 201, response.text
    application = db_session.query(Application).filter(Application.job_posting_id == vacancy.job_posting.id).one()
    assert application.qualification_mismatch is True


# --- apply: refusals ---------------------------------------------------------


def test_apply_twice_to_the_same_posting_is_409(client, db_session, published_vacancy_factory, super_admin):
    vacancy = published_vacancy_factory(campus_code="SSE")
    url = apply_url(vacancy.job_posting.public_apply_slug)

    assert client.post(url, data=_form(), files=_pdf()).status_code == 201
    second = client.post(url, data=_form(email="ASHA@example.com"), files=_pdf())

    assert second.status_code == 409
    assert "already" in second.json()["detail"]
    assert db_session.query(Application).count() == 1


@pytest.mark.parametrize("state", ["paused", "closed", "expired"])
def test_apply_is_refused_when_the_posting_is_not_accepting(
    client, db_session, published_vacancy_factory, super_admin, state
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    if state == "paused":
        vacancy.job_posting.status = JobPostingStatusEnum.PAUSED
    elif state == "closed":
        vacancy_workflow.close(db_session, vacancy.vacancy_request, vacancy.approved_vacancy, vacancy.job_posting, vacancy.hr_admin, None)
    else:
        vacancy.job_posting.apply_deadline = date.today() - timedelta(days=1)
    db_session.flush()

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=_pdf())

    assert response.status_code == 409
    assert "no longer accepting" in response.json()["detail"]
    assert db_session.query(Candidate).count() == 0
    assert db_session.query(Application).count() == 0


def test_apply_unknown_slug_is_404_and_creates_nothing(client, db_session, super_admin):
    response = client.post(apply_url("never-existed-0000"), data=_form(), files=_pdf())
    assert response.status_code == 404
    assert db_session.query(Candidate).count() == 0


@pytest.mark.parametrize(
    "files, expected",
    [
        ({"resume": ("resume.docx", b"not a pdf", "application/octet-stream")}, "Only PDF"),
        ({"resume": ("resume.pdf", b"%PDF-1.4 but garbage", "application/pdf")}, "not a valid PDF"),
        ({"resume": ("resume.pdf", b"", "application/pdf")}, "empty"),
    ],
)
def test_apply_refuses_anything_but_a_real_pdf(client, db_session, published_vacancy_factory, super_admin, files, expected):
    vacancy = published_vacancy_factory(campus_code="SSE")

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=files)

    assert response.status_code == 400
    assert expected in response.json()["detail"]
    assert db_session.query(Candidate).count() == 0


def test_apply_without_a_resume_is_422(client, published_vacancy_factory, super_admin):
    vacancy = published_vacancy_factory(campus_code="SSE")
    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form())
    assert response.status_code == 422


@pytest.mark.parametrize("bad", [{"email": "not-an-email"}, {"full_name": "A"}, {"full_name": "x" * 151}])
def test_apply_validates_the_text_fields(client, db_session, published_vacancy_factory, super_admin, bad):
    vacancy = published_vacancy_factory(campus_code="SSE")

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(**bad), files=_pdf())

    assert response.status_code == 422
    assert db_session.query(Candidate).count() == 0


def test_apply_honeypot_is_discarded_and_audited(client, db_session, published_vacancy_factory, super_admin):
    vacancy = published_vacancy_factory(campus_code="SSE")

    response = client.post(
        apply_url(vacancy.job_posting.public_apply_slug), data=_form(website="http://spam.example"), files=_pdf()
    )

    assert response.status_code == 400
    assert "honeypot" not in response.json()["detail"].lower()
    assert db_session.query(Candidate).count() == 0
    blocked = db_session.query(AuditLog).filter(AuditLog.action == "PUBLIC_APPLICATION_BLOCKED").one()
    assert blocked.after_state["reason"] == "honeypot"


def test_apply_is_rate_limited_per_ip(client, published_vacancy_factory, super_admin):
    vacancy = published_vacancy_factory(campus_code="SSE")
    url = apply_url(vacancy.job_posting.public_apply_slug)

    for n in range(5):
        response = client.post(url, data=_form(email=f"person{n}@example.com"), files=_pdf())
        assert response.status_code == 201, response.text
    sixth = client.post(url, data=_form(email="person6@example.com"), files=_pdf())

    assert sixth.status_code == 429


def test_apply_when_storage_is_unreachable_is_502_and_creates_nothing(
    client, db_session, published_vacancy_factory, super_admin, fake_minio_client
):
    """A resume that did not land is not an application. The storage wrapper
    turns the transport failure into a 502 (not a 500) and no application is
    recorded. (The candidate row staged before the upload is rolled back by
    `get_db` in a real request -- proven live 2026-09-07 -- but the test
    client shares this session, where a flushed row stays visible, so that
    half is not asserted here.)"""
    vacancy = published_vacancy_factory(campus_code="SSE")
    fake_minio_client.fail_puts = True

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=_pdf())

    assert response.status_code == 502
    assert "object storage" in response.json()["detail"]
    assert db_session.query(Application).count() == 0


def test_apply_without_an_intake_account_is_503_not_500(client, db_session, published_vacancy_factory):
    """`published_vacancy_factory` creates no SUPER_ADMIN, so nothing can own
    the application row -- the same 503 the QR intake gives."""
    vacancy = published_vacancy_factory(campus_code="SSE")

    response = client.post(apply_url(vacancy.job_posting.public_apply_slug), data=_form(), files=_pdf())

    assert response.status_code == 503
    assert db_session.query(Application).count() == 0


# --- the apply link ----------------------------------------------------------


def test_apply_link_points_at_this_apps_careers_page_by_default(monkeypatch, client, published_vacancy_factory):
    monkeypatch.setattr(settings, "PUBLIC_APPLY_BASE_URL", "", raising=False)
    monkeypatch.setattr(settings, "PUBLIC_APP_BASE_URL", "https://app.malathi.io", raising=False)
    vacancy = published_vacancy_factory(campus_code="SSE")
    from tests.conftest import auth_headers

    body = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, vacancy.hr_admin)
    ).json()

    assert body["apply_url"] == f"https://app.malathi.io/careers/{vacancy.job_posting.public_apply_slug}"


def test_apply_link_honours_a_separate_careers_domain_when_configured(monkeypatch, client, published_vacancy_factory):
    monkeypatch.setattr(settings, "PUBLIC_APPLY_BASE_URL", "https://careers.example.edu/", raising=False)
    vacancy = published_vacancy_factory(campus_code="SSE")
    from tests.conftest import auth_headers

    body = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, vacancy.hr_admin)
    ).json()

    assert body["apply_url"] == f"https://careers.example.edu/careers/{vacancy.job_posting.public_apply_slug}"
