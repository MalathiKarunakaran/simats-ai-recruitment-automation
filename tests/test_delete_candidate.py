from datetime import datetime, timezone

from app.models.enums import PermissionEnum, UserRoleEnum
from app.models.resume_score import ResumeScore

from tests.conftest import auth_headers


def test_delete_fresh_candidate_succeeds_for_super_admin(client, user_factory, candidate_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    candidate = candidate_factory()

    response = client.delete(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, admin))
    assert response.status_code == 204

    get_response = client.get(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, admin))
    assert get_response.status_code == 404


def test_delete_blocked_by_application_reference(
    client, user_factory, candidate_factory, published_vacancy_factory, application_factory
):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    candidate = candidate_factory()
    application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)

    response = client.delete(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "application or resume-screening history" in response.json()["detail"]


def test_delete_blocked_by_resume_score_duplicate_reference(
    client,
    user_factory,
    candidate_factory,
    published_vacancy_factory,
    application_factory,
    db_session,
):
    # The target candidate (candidate_a) has no Application row of their own
    # -- only a ResumeScore belonging to a *different* candidate's
    # application flags candidate_a as the duplicate-of match (this is the
    # SET NULL FK case the DB itself would silently allow -- see
    # candidates.py's _candidate_has_related_records docstring).
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    candidate_a = candidate_factory()
    candidate_b = candidate_factory()
    application_b = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate_b)

    db_session.add(
        ResumeScore(
            application_id=application_b.id,
            is_duplicate=True,
            duplicate_of_candidate_id=candidate_a.id,
            screened_at=datetime.now(timezone.utc),
        )
    )
    db_session.flush()

    response = client.delete(f"/api/v1/candidates/{candidate_a.id}", headers=auth_headers(client, admin))
    assert response.status_code == 409
    assert "application or resume-screening history" in response.json()["detail"]

    # candidate_b (the one with the real Application) is untouched by this
    # assertion -- deleting candidate_a must not have side effects on it.
    still_there = client.get(f"/api/v1/candidates/{candidate_b.id}", headers=auth_headers(client, admin))
    assert still_there.status_code == 200


def test_delete_candidate_requires_permission(client, user_factory, candidate_factory):
    # Nobody has DELETE_CANDIDATE by default per Phase 1 -- not even
    # HR_ADMIN, who can otherwise write everything else about a candidate.
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    candidate = candidate_factory()

    response = client.delete(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 403


def test_delete_candidate_succeeds_with_explicit_grant(
    client, user_factory, candidate_factory, grant_permission
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    grant_permission(hr_admin, PermissionEnum.DELETE_CANDIDATE)
    candidate = candidate_factory()

    response = client.delete(f"/api/v1/candidates/{candidate.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 204


def test_delete_unknown_candidate_id_returns_404(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.delete(
        "/api/v1/candidates/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(client, admin),
    )
    assert response.status_code == 404
