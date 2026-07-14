from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers, build_test_pdf


def test_download_resume_returns_404_when_none_uploaded(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.get(f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, hr_admin))
    assert response.status_code == 404


def test_download_resume_returns_404_for_unknown_candidate(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(
        "/api/v1/candidates/00000000-0000-0000-0000-000000000000/resume", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 404


def test_download_resume_happy_path(client, user_factory, candidate_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()
    pdf_bytes = build_test_pdf("Resume content for download test.")

    upload = client.post(
        f"/api/v1/candidates/{candidate.id}/resume",
        headers=auth_headers(client, hr_admin),
        files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 200

    response = client.get(f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_download_resume_forbidden_for_candidate_role(client, user_factory, candidate_factory):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    candidate = candidate_factory()

    response = client.get(
        f"/api/v1/candidates/{candidate.id}/resume", headers=auth_headers(client, candidate_user)
    )
    assert response.status_code == 403
