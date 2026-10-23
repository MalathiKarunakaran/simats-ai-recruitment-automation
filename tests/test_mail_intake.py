"""Recruitment mail intake (2026-10-17), Phase 1.

What is pinned here is as much about what intake does NOT do as what it
does: it records, it is idempotent, it is gated by a shared secret, and it
leaves every classification column alone. The last one matters most -- the
columns exist for Phase 2, and a Phase 1 that quietly started filling them
in would be the bug that is hardest to see later.
"""

import base64
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.enums import GLOBAL_SCOPE_ROLES, UserRoleEnum
from app.models.inbound_email import EmailAttachment, InboundEmail
from app.services import mail_intake

from tests.conftest import auth_headers

SECRET = "test-mail-intake-secret"


@pytest.fixture(autouse=True)
def _configured_secret(monkeypatch):
    """Every test here assumes intake is configured; the one test that cares
    about the unconfigured case overrides this itself."""
    monkeypatch.setattr(settings, "MAIL_INTAKE_SECRET", SECRET)


def _payload(**overrides) -> dict:
    payload = {
        "gmail_message_id": "msg-0001",
        "thread_id": "thread-0001",
        "from_email": "Priya.Candidate@example.com",
        "from_name": "Priya R",
        "subject": "Application for Assistant Professor, CSE",
        "body_text": "Respected Sir/Madam, please find my resume attached.",
        "received_at": datetime(2026, 10, 17, 9, 30, tzinfo=timezone.utc).isoformat(),
        "attachments": [],
    }
    payload.update(overrides)
    return payload


def _attachment(filename="Priya_Resume.pdf", content=b"%PDF-1.4 fake", mime="application/pdf") -> dict:
    return {
        "filename": filename,
        "mime_type": mime,
        "content_base64": base64.b64encode(content).decode(),
    }


def _post(client, payload, *, secret=SECRET):
    headers = {"X-Mail-Intake-Secret": secret} if secret is not None else {}
    return client.post("/api/v1/inbound-emails", json=payload, headers=headers)


# --- the write ---------------------------------------------------------------


def test_records_a_message_and_its_attachment(client, db_session, fake_minio_client):
    response = _post(client, _payload(attachments=[_attachment()]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] is True
    assert body["attachments_stored"] == 1

    email = db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").one()
    # Lower-cased on the way in: the same person writing from the same address
    # must not read as two senders because their client capitalised it.
    assert email.from_email == "priya.candidate@example.com"
    assert email.subject == "Application for Assistant Professor, CSE"
    assert email.attachment_count == 1

    attachment = email.attachments[0]
    # The original name is kept on the row; the key is the sanitised form.
    assert attachment.filename == "Priya_Resume.pdf"
    assert attachment.storage_path == f"{email.id}/Priya_Resume.pdf"
    assert attachment.is_resume is True
    assert (
        settings.MINIO_BUCKET_EMAIL_ATTACHMENTS,
        attachment.storage_path,
    ) in fake_minio_client._objects


def test_phase_1_classifies_nothing(client, db_session, fake_minio_client):
    """The whole point of Phase 1. Every classification column and every link
    out stays empty, and the row stays on the pending side of
    `processed_at IS NULL`."""
    _post(client, _payload(attachments=[_attachment()]))
    email = db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").one()
    assert email.category is None
    assert email.confidence is None
    assert email.needs_review is False
    assert email.processed_at is None
    assert email.is_processed is False
    assert email.error is None
    assert email.linked_candidate_id is None
    assert email.linked_application_id is None
    assert email.linked_job_posting_id is None


def test_a_replay_writes_nothing_and_is_still_a_success(client, db_session, fake_minio_client):
    first = _post(client, _payload(attachments=[_attachment()]))
    second = _post(client, _payload(attachments=[_attachment()]))

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    # Same row, and the attachment was not stored twice.
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["attachments_stored"] == 0
    assert db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").count() == 1
    assert db_session.query(EmailAttachment).count() == 1


def test_the_unique_constraint_is_the_guarantee_not_the_pre_check(
    client, db_session, fake_minio_client
):
    """`record_email` checks for an existing row first, but that check is not
    what makes intake idempotent -- the UNIQUE index is. Simulated here by
    inserting the row behind the service's back, after its SELECT would have
    come back empty, which is what two racing n8n workers do."""
    from app.schemas.inbound_email import InboundEmailIngest

    payload = InboundEmailIngest.model_validate(_payload())
    db_session.add(
        InboundEmail(
            gmail_message_id="msg-0001",
            from_email="someone.else@example.com",
            received_at=datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc),
        )
    )
    db_session.flush()

    email, created, stored = mail_intake.record_email(
        db_session, fake_minio_client, payload=payload, decoded_attachments=[]
    )
    assert created is False
    assert stored == 0
    # The row that was already there won, and intake did not overwrite it.
    assert email.from_email == "someone.else@example.com"
    assert db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").count() == 1


def test_a_duplicate_does_not_discard_the_callers_other_work(
    client, db_session, fake_minio_client, candidate_factory
):
    """Regression guard for the savepoint. Handling the duplicate with a plain
    db.rollback() would undo rows the caller had already written -- here a
    Candidate created before intake ran."""
    from app.schemas.inbound_email import InboundEmailIngest

    candidate = candidate_factory()
    candidate_id = candidate.id
    db_session.add(
        InboundEmail(
            gmail_message_id="msg-0001",
            from_email="first@example.com",
            received_at=datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc),
        )
    )
    db_session.flush()

    mail_intake.record_email(
        db_session,
        fake_minio_client,
        payload=InboundEmailIngest.model_validate(_payload()),
        decoded_attachments=[],
    )
    from app.models.candidate import Candidate

    assert db_session.get(Candidate, candidate_id) is not None


def test_two_attachments_with_one_name_get_two_keys(client, db_session, fake_minio_client):
    response = _post(
        client,
        _payload(
            attachments=[
                _attachment(filename="resume.pdf", content=b"%PDF-1.4 first"),
                _attachment(filename="resume.pdf", content=b"%PDF-1.4 second"),
            ]
        ),
    )
    assert response.status_code == 200
    assert response.json()["attachments_stored"] == 2
    email = db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").one()
    keys = sorted(a.storage_path for a in email.attachments)
    assert keys == [f"{email.id}/resume.pdf", f"{email.id}/resume_2.pdf"]
    # Both sets of bytes really landed, rather than one overwriting the other.
    assert len({fake_minio_client._objects[(settings.MINIO_BUCKET_EMAIL_ATTACHMENTS, k)] for k in keys}) == 2


def test_a_filename_cannot_escape_its_own_email_folder(client, db_session, fake_minio_client):
    _post(client, _payload(attachments=[_attachment(filename="../../etc/passwd")]))
    attachment = db_session.query(EmailAttachment).one()
    email_id = attachment.inbound_email_id
    assert attachment.storage_path.startswith(f"{email_id}/")
    assert ".." not in attachment.storage_path
    assert attachment.storage_path.count("/") == 1
    # The name the sender used is still recorded, unaltered.
    assert attachment.filename == "../../etc/passwd"


def test_real_mail_with_no_subject_or_body_is_still_recorded(client, db_session, fake_minio_client):
    response = _post(client, _payload(subject=None, body_text=None, from_name=None, thread_id=None))
    assert response.status_code == 200
    email = db_session.query(InboundEmail).filter_by(gmail_message_id="msg-0001").one()
    assert email.subject is None
    assert email.body_text is None


def test_an_oversized_attachment_is_refused_and_nothing_is_recorded(
    client, db_session, fake_minio_client, monkeypatch
):
    from app.api.v1.routers import inbound_emails as router_module

    monkeypatch.setattr(router_module, "_MAX_ATTACHMENT_BYTES", 32)
    response = _post(client, _payload(attachments=[_attachment(content=b"x" * 64)]))
    # 400, matching every other upload cap in this app, rather than a 413.
    assert response.status_code == 400
    # The email is rejected whole -- no half-written row with a missing file.
    assert db_session.query(InboundEmail).count() == 0
    assert db_session.query(EmailAttachment).count() == 0


def test_a_malformed_attachment_is_a_400_about_the_request(client, db_session, fake_minio_client):
    response = _post(
        client,
        _payload(attachments=[{"filename": "x.pdf", "mime_type": "application/pdf", "content_base64": "not!base64"}]),
    )
    assert response.status_code == 400
    assert db_session.query(InboundEmail).count() == 0


def test_a_bad_email_address_is_refused(client, fake_minio_client):
    assert _post(client, _payload(from_email="not-an-address")).status_code == 422


# --- the gate ----------------------------------------------------------------


def test_no_secret_no_intake(client, db_session, fake_minio_client):
    assert _post(client, _payload(), secret=None).status_code == 401
    assert _post(client, _payload(), secret="wrong-secret").status_code == 401
    assert db_session.query(InboundEmail).count() == 0


def test_an_unconfigured_secret_closes_the_endpoint_rather_than_opening_it(
    client, db_session, fake_minio_client, monkeypatch
):
    monkeypatch.setattr(settings, "MAIL_INTAKE_SECRET", "")
    # Not 401: the endpoint is unavailable, not the caller unauthorised. And
    # emphatically not 200 -- an unset secret must never mean "no gate".
    assert _post(client, _payload(), secret=None).status_code == 503
    assert _post(client, _payload(), secret="anything").status_code == 503
    assert db_session.query(InboundEmail).count() == 0


def test_a_staff_token_is_not_a_way_in(client, db_session, user_factory, fake_minio_client):
    """The intake endpoint takes the secret and nothing else. A logged-in
    SUPER_ADMIN is still not n8n."""
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/inbound-emails", json=_payload(), headers=auth_headers(client, admin)
    )
    assert response.status_code == 401
    assert db_session.query(InboundEmail).count() == 0


# --- the reads ---------------------------------------------------------------


def _seed(client, db_session, fake_minio_client, n=3):
    base = datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)
    for i in range(n):
        _post(
            client,
            _payload(
                gmail_message_id=f"msg-{i:04d}",
                subject=f"Enquiry number {i}",
                from_email=f"sender{i}@example.com",
                received_at=(base + timedelta(hours=i)).isoformat(),
                attachments=[_attachment(filename=f"cv{i}.pdf")],
            ),
        )
    return db_session.query(InboundEmail).count()


def test_the_log_lists_newest_first(client, db_session, user_factory, fake_minio_client):
    _seed(client, db_session, fake_minio_client, n=3)
    admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/inbound-emails", headers=auth_headers(client, admin))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert [item["gmail_message_id"] for item in body["items"]] == ["msg-0002", "msg-0001", "msg-0000"]
    assert body["items"][0]["attachment_count"] == 1


def test_pending_filter_matches_everything_in_phase_1(client, db_session, user_factory, fake_minio_client):
    _seed(client, db_session, fake_minio_client, n=2)
    admin = user_factory(UserRoleEnum.HR_ADMIN)
    headers = auth_headers(client, admin)
    assert client.get("/api/v1/inbound-emails?processed=false", headers=headers).json()["total"] == 2
    assert client.get("/api/v1/inbound-emails?processed=true", headers=headers).json()["total"] == 0


def test_the_log_can_be_filtered_by_sender_and_subject(client, db_session, user_factory, fake_minio_client):
    _seed(client, db_session, fake_minio_client, n=3)
    headers = auth_headers(client, user_factory(UserRoleEnum.HR_ADMIN))
    # Case-insensitively, matching how the address was stored.
    by_sender = client.get("/api/v1/inbound-emails?from_email=Sender1@EXAMPLE.com", headers=headers)
    assert by_sender.json()["total"] == 1
    by_subject = client.get("/api/v1/inbound-emails?q=number 2", headers=headers)
    assert by_subject.json()["total"] == 1


def test_one_message_opened_shows_its_body_and_attachments(
    client, db_session, user_factory, fake_minio_client
):
    _post(client, _payload(attachments=[_attachment()]))
    email = db_session.query(InboundEmail).one()
    headers = auth_headers(client, user_factory(UserRoleEnum.HR_ADMIN))
    response = client.get(f"/api/v1/inbound-emails/{email.id}", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["body_text"].startswith("Respected Sir/Madam")
    assert len(body["attachments"]) == 1
    assert body["attachments"][0]["filename"] == "Priya_Resume.pdf"
    assert body["attachments"][0]["size_bytes"] == len(b"%PDF-1.4 fake")


def test_an_attachment_comes_back_as_sent_and_as_a_download(
    client, db_session, user_factory, fake_minio_client
):
    _post(client, _payload(attachments=[_attachment(content=b"%PDF-1.4 the real bytes")]))
    attachment = db_session.query(EmailAttachment).one()
    headers = auth_headers(client, user_factory(UserRoleEnum.HR_ADMIN))
    response = client.get(
        f"/api/v1/inbound-emails/attachments/{attachment.id}/file", headers=headers
    )
    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 the real bytes"
    # Never inline: these bytes came from outside and were not verified
    # against their declared type.
    assert response.headers["content-disposition"].startswith("attachment;")


def test_the_mail_log_is_staff_only(client, db_session, user_factory, fake_minio_client):
    _seed(client, db_session, fake_minio_client, n=1)
    email = db_session.query(InboundEmail).first()
    for role in (UserRoleEnum.CAMPUS_HOD, UserRoleEnum.INTERVIEW_PANEL_MEMBER, UserRoleEnum.CANDIDATE):
        headers = auth_headers(client, user_factory(role, campus_code="SSE"))
        assert client.get("/api/v1/inbound-emails", headers=headers).status_code == 403
        assert client.get(f"/api/v1/inbound-emails/{email.id}", headers=headers).status_code == 403
    assert client.get("/api/v1/inbound-emails").status_code == 401


def test_every_mail_log_reader_is_campus_global():
    """The log has no campus_id to scope by, so an unscoped read is only
    defensible while every reader already sees all campuses. If a
    single-campus role is ever added to the list, this fails rather than
    silently leaking another campus's mail."""
    from app.api.v1.routers.inbound_emails import _MAIL_LOG_READERS

    assert set(_MAIL_LOG_READERS) <= set(GLOBAL_SCOPE_ROLES)


# --- the resume guess --------------------------------------------------------


@pytest.mark.parametrize(
    "filename,mime,expected",
    [
        ("Priya_Resume.pdf", "application/pdf", True),
        ("my cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", True),
        ("biodata.pdf", "application/pdf", True),
        ("certificate.pdf", "application/pdf", True),
        ("signature.png", "image/png", False),
        ("notes.txt", "text/plain", False),
    ],
)
def test_the_resume_guess_is_a_guess(filename, mime, expected):
    assert mail_intake.looks_like_resume(filename, mime) is expected
