"""Joining-document files (2026-09-07): upload marks the row received and
stores the bytes; download returns them; only real PDF/JPEG/PNG under 10 MB
are taken; campus scope holds; a failed store leaves the row untouched.
"""

from datetime import date

from app.core.config import settings
from app.models.enums import JoiningDocumentStatusEnum
from app.models.joining import JoiningDocument
from app.services import joining as joining_service

from tests.conftest import auth_headers, build_test_pdf

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _checklist(db_session, vacancy, candidate_factory, application_factory):
    """A JOINING_CONFIRMED-shaped application with its six pending rows."""
    application = application_factory(vacancy.job_posting, vacancy.recruitment_officer, candidate_factory())
    joining_service.initialize_joining_checklist(
        db_session, application=application, joining_date=date.today(), actor=vacancy.hr_admin
    )
    db_session.flush()
    rows = db_session.query(JoiningDocument).filter(JoiningDocument.application_id == application.id).all()
    return application, {row.document_type: row for row in rows}


def _upload(client, actor, document, *, name="degree.pdf", data=None, content_type="application/pdf"):
    return client.post(
        f"/api/v1/joining-documents/{document.id}/file",
        headers=auth_headers(client, actor),
        files={"file": (name, data if data is not None else build_test_pdf("B.E. Degree Certificate"), content_type)},
    )


def test_upload_stores_the_file_and_marks_the_row_received(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory, fake_minio_client
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    application, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    row = rows["DEGREE_CERTIFICATE"]
    assert row.status == JoiningDocumentStatusEnum.PENDING

    response = _upload(client, vacancy.hr_admin, row)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "RECEIVED"
    assert body["received_at"] is not None
    assert body["storage_key"] == f"{application.id}/DEGREE_CERTIFICATE/degree.pdf"
    assert (settings.MINIO_BUCKET_JOINING_DOCUMENTS, body["storage_key"]) in fake_minio_client._objects


def test_download_returns_the_stored_bytes_inline(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    row = rows["PHOTO"]
    assert _upload(client, vacancy.hr_admin, row, name="photo.png", data=PNG, content_type="image/png").status_code == 200

    response = client.get(f"/api/v1/joining-documents/{row.id}/file", headers=auth_headers(client, vacancy.hr_admin))

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert 'filename="photo.png"' in response.headers["content-disposition"]
    assert response.content == PNG


def test_download_before_any_upload_is_404(client, db_session, published_vacancy_factory, candidate_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)

    response = client.get(
        f"/api/v1/joining-documents/{rows['PAN'].id}/file", headers=auth_headers(client, vacancy.hr_admin)
    )

    assert response.status_code == 404
    assert "No file" in response.json()["detail"]


def test_recruitment_officer_of_the_campus_can_upload(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)

    response = _upload(client, vacancy.recruitment_officer, rows["AADHAAR"], name="aadhaar.jpg", data=JPEG, content_type="image/jpeg")

    assert response.status_code == 200


def test_another_campus_cannot_see_or_upload(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory, user_factory
):
    from app.models.enums import UserRoleEnum

    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    outsider = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCLAS")

    assert _upload(client, outsider, rows["PAN"]).status_code == 404
    assert client.get(f"/api/v1/joining-documents/{rows['PAN'].id}/file", headers=auth_headers(client, outsider)).status_code == 404


def test_rejects_wrong_type_mismatched_bytes_and_empty_files(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    row = rows["BANK_DETAILS"]

    cases = [
        ("notes.docx", b"PK\x03\x04", "application/octet-stream", "Only PDF, JPEG or PNG"),
        ("fake.png", b"not really a png", "image/png", "does not match"),
        ("bad.pdf", b"%PDF-1.4 garbage", "application/pdf", "not a valid PDF"),
        ("empty.pdf", b"", "application/pdf", "empty"),
        ("big.png", PNG + b"\x00" * (10 * 1024 * 1024), "image/png", "10 MB"),
    ]
    for name, data, content_type, expected in cases:
        response = _upload(client, vacancy.hr_admin, row, name=name, data=data, content_type=content_type)
        assert response.status_code == 400, name
        assert expected in response.json()["detail"], name

    db_session.refresh(row)
    assert row.status == JoiningDocumentStatusEnum.PENDING
    assert row.storage_key is None


def test_storage_failure_is_502_and_leaves_the_row_pending(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory, fake_minio_client
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    _, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    row = rows["EXPERIENCE_CERTIFICATE"]
    fake_minio_client.fail_puts = True

    response = _upload(client, vacancy.hr_admin, row)

    assert response.status_code == 502
    db_session.refresh(row)
    assert row.status == JoiningDocumentStatusEnum.PENDING
    assert row.storage_key is None


def test_a_second_upload_replaces_the_file(
    client, db_session, published_vacancy_factory, candidate_factory, application_factory, fake_minio_client
):
    vacancy = published_vacancy_factory(campus_code="SSE")
    application, rows = _checklist(db_session, vacancy, candidate_factory, application_factory)
    row = rows["DEGREE_CERTIFICATE"]
    assert _upload(client, vacancy.hr_admin, row, name="v1.pdf").status_code == 200
    second = _upload(client, vacancy.hr_admin, row, name="v2.pdf", data=build_test_pdf("Second scan"))

    assert second.status_code == 200
    assert second.json()["storage_key"] == f"{application.id}/DEGREE_CERTIFICATE/v2.pdf"
