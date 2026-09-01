import io

from PIL import Image

from app.models.audit_log import AuditLog
from app.models.enums import CoordinatorCapabilityEnum, PermissionEnum, UserRoleEnum
from app.services.n8n_client import get_n8n_client_or_503

from tests.conftest import FakeN8nClient, auth_headers


def test_get_job_ad_returns_ad_fields(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/ad", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["campus_code"] == "SSE"
    assert body["position_title"] == vacancy.vacancy_request.position_title
    assert vacancy.job_posting.public_apply_slug in body["apply_url"]


def test_get_qr_code_returns_decodable_png(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/qr-code", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"

    image = Image.open(io.BytesIO(response.content))
    assert image.format == "PNG"


def test_distribute_returns_503_when_n8n_unconfigured(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.post(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
        headers=auth_headers(client, vacancy.hr_admin),
        json={},
    )
    assert response.status_code == 503


def test_distribute_succeeds_when_n8n_configured(client, published_vacancy_factory, db_session):
    from app.main import app

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    fake_client = FakeN8nClient()
    app.dependency_overrides[get_n8n_client_or_503] = lambda: fake_client
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"portals": ["LINKEDIN", "INDEED"]},
        )
    finally:
        del app.dependency_overrides[get_n8n_client_or_503]

    assert response.status_code == 200
    body = response.json()
    assert body["portals"] == ["LINKEDIN", "INDEED"]
    assert len(fake_client.calls) == 1

    audit_row = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "JOB_POSTING_DISTRIBUTED", AuditLog.entity_id == vacancy.job_posting.id)
        .one()
    )
    assert audit_row.after_state["portals"] == ["LINKEDIN", "INDEED"]


def test_distribute_rejects_unsupported_portal(client, published_vacancy_factory):
    from app.main import app

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    app.dependency_overrides[get_n8n_client_or_503] = lambda: FakeN8nClient()
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, vacancy.hr_admin),
            json={"portals": ["FAKEPORTAL"]},
        )
    finally:
        del app.dependency_overrides[get_n8n_client_or_503]

    assert response.status_code == 400


def test_recruitment_coordinator_without_grant_forbidden_to_distribute(
    client, published_vacancy_factory, user_factory
):
    from app.main import app

    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)
    app.dependency_overrides[get_n8n_client_or_503] = lambda: FakeN8nClient()
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, coordinator),
            json={"portals": ["LINKEDIN"]},
        )
    finally:
        del app.dependency_overrides[get_n8n_client_or_503]

    assert response.status_code == 403


def test_recruitment_coordinator_with_grant_can_distribute(
    client, published_vacancy_factory, user_factory, grant_coordinator_capability, grant_permission
):
    from app.main import app

    # Both grants inserted directly -- CoordinatorCapabilityGrant (still
    # real) plus the UserPermissionGrant this endpoint actually checks now
    # (require_permission(JOB_DISTRIBUTION)), mirroring what a real
    # coordinator would have post-migration-backfill (e5a4d57be056 maps
    # JOB_DISTRIBUTION_SCREENING onto JOB_DISTRIBUTION/RESUME_SCREENING) --
    # the test DB never runs that migration, so both are inserted directly.
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.JOB_DISTRIBUTION_SCREENING)
    grant_permission(coordinator, PermissionEnum.JOB_DISTRIBUTION)
    app.dependency_overrides[get_n8n_client_or_503] = lambda: FakeN8nClient()
    try:
        response = client.post(
            f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
            headers=auth_headers(client, coordinator),
            json={"portals": ["LINKEDIN"]},
        )
    finally:
        del app.dependency_overrides[get_n8n_client_or_503]

    assert response.status_code == 200


def test_distribute_rbac_denies_campus_hod(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.post(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/distribute",
        headers=auth_headers(client, vacancy.hod),
        json={},
    )
    assert response.status_code == 403


def test_ad_enforces_campus_scope(client, published_vacancy_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    response = client.get(
        f"/api/v1/job-postings/{vacancy_scad.job_posting.id}/ad",
        headers=auth_headers(client, vacancy_sse.recruitment_officer),
    )
    assert response.status_code == 404
