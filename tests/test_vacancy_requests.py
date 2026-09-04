import uuid

import pytest

from app.models.enums import (
    CoordinatorCapabilityEnum,
    PermissionEnum,
    UserRoleEnum,
    VacancyRequestSourceEnum,
)
from app.models.vacancy_request import VacancyRequest

from tests.conftest import auth_headers


def _transition_application(client, application_id, actor, new_status, reason=None):
    body = {"status": new_status}
    if reason is not None:
        body["reason"] = reason
    return client.patch(
        f"/api/v1/applications/{application_id}/status", headers=auth_headers(client, actor), json=body
    )


def _create_payload(department_id, **overrides):
    payload = {
        "campus_id": None,
        "department_id": str(department_id),
        "role_category": "TEACHING",
        "position_title": "Assistant Professor",
        "employment_type": "FULL_TIME",
        "requested_count": 2,
        "qualification": "PhD",
        "experience_required": "3+ years",
        "priority": "HIGH",
    }
    payload.update(overrides)
    return payload


def test_hod_can_create_vacancy_request_for_own_campus(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 201
    assert response.json()["status"] == "DRAFT"


def test_hod_cannot_create_vacancy_request_for_other_campus(client, user_factory, department_factory):
    sse_department = department_factory("SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_scad),
        json=_create_payload(sse_department.id, campus_id=str(sse_department.campus_id)),
    )
    assert response.status_code == 403


def test_hod_with_own_department_can_raise_for_own_department(client, user_factory, department_factory, db_session):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod.department_id = department.id
    db_session.flush()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 201


def test_hod_with_own_department_cannot_raise_for_other_department(
    client, user_factory, department_factory, db_session
):
    own_department = department_factory("SSE", "Own Department")
    other_department = department_factory("SSE", "Other Department")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod.department_id = own_department.id
    db_session.flush()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(other_department.id, campus_id=str(other_department.campus_id)),
    )
    assert response.status_code == 403


def test_hod_without_own_department_is_unrestricted_across_own_campus_departments(
    client, user_factory, department_factory
):
    # Non-breaking: a HOD with no department_id set (the common case today)
    # keeps the pre-existing campus-scoped-only behavior.
    department_a = department_factory("SSE", "Department A")
    department_b = department_factory("SSE", "Department B")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    assert hod.department_id is None

    response_a = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department_a.id, campus_id=str(department_a.campus_id)),
    )
    assert response_a.status_code == 201

    response_b = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department_b.id, campus_id=str(department_b.campus_id)),
    )
    assert response_b.status_code == 201


def test_designation_id_auto_populates_position_title(client, user_factory, department_factory):
    department = department_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    designation_response = client.post(
        "/api/v1/designations",
        headers=auth_headers(client, super_admin),
        json={
            "name": "Professor of Data Science",
            "category": "TEACHING",
            "qualification": "PhD",
            "min_experience": "5+ years",
            "employment_type": "FULL_TIME",
        },
    )
    assert designation_response.status_code == 201
    designation_id = designation_response.json()["id"]

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, super_admin),
        json=_create_payload(
            department.id,
            campus_id=str(department.campus_id),
            designation_id=designation_id,
            position_title="ignored placeholder text",
        ),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["designation_id"] == designation_id
    assert body["position_title"] == "Professor of Data Science"


def test_designation_id_unknown_is_rejected(client, user_factory, department_factory):
    import uuid

    department = department_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, super_admin),
        json=_create_payload(
            department.id, campus_id=str(department.campus_id), designation_id=str(uuid.uuid4())
        ),
    )
    assert response.status_code == 400


def test_full_approval_chain_creates_slots_and_posting(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id), requested_count=3),
    )
    vr_id = create.json()["id"]

    submitted = client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    assert submitted.json()["status"] == "SUBMITTED"

    dean_approved = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean)
    )
    assert dean_approved.json()["status"] == "DEAN_APPROVED"

    hr_approved = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert hr_approved.status_code == 200
    approved_vacancy_id = hr_approved.json()["id"]
    assert hr_approved.json()["total_positions"] == 3

    slots = client.get(
        f"/api/v1/approved-vacancies/{approved_vacancy_id}/hiring-slots", headers=auth_headers(client, hr_admin)
    )
    assert slots.json()["total"] == 3
    assert all(s["status"] == "OPEN" for s in slots.json()["items"])

    published = client.post(f"/api/v1/vacancy-requests/{vr_id}/publish", headers=auth_headers(client, hr_admin))
    assert published.status_code == 200
    assert published.json()["is_active"] is True

    vr_detail = client.get(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hr_admin))
    assert vr_detail.json()["status"] == "PUBLISHED"


def test_recruitment_officer_cannot_dean_approve(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, officer)
    )
    assert response.status_code == 403


def test_reject_requires_reason(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject", headers=auth_headers(client, dean), json={"reason": ""}
    )
    assert response.status_code == 422


def test_super_admin_can_hr_approve_directly_from_submitted(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, super_admin)
    )
    assert response.status_code == 200


def test_hr_admin_cannot_hr_approve_from_submitted_without_dean(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 409


def test_cannot_edit_non_draft_vacancy_request(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hod), json={"position_title": "Changed"}
    )
    assert response.status_code == 409


def test_editing_a_draft_with_a_salary_band_set_round_trips_as_float(client, user_factory, department_factory):
    # Regression test: VacancyRequest.salary_band_min/max are Numeric columns
    # that SQLAlchemy returns as decimal.Decimal by default once a row is
    # reloaded from the DB (contradicting their Mapped[float | None] type
    # hint) -- the PATCH audit-log snapshot embeds the freshly-loaded value
    # directly into a dict destined for JSON storage, which crashed with
    # "Object of type Decimal is not JSON serializable" before the columns
    # were declared asdecimal=False.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id), salary_band_min=50000, salary_band_max=70000),
    )
    assert create.status_code == 201
    vr_id = create.json()["id"]

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}",
        headers=auth_headers(client, hod),
        json={"salary_band_min": 55000, "salary_band_max": 75000},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["salary_band_min"] == 55000
    assert body["salary_band_max"] == 75000
    assert isinstance(body["salary_band_min"], float | int)


def test_management_cannot_create_vacancy_request(client, user_factory, department_factory):
    department = department_factory("SSE")
    management = user_factory(UserRoleEnum.MANAGEMENT)

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, management),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 403


# --- Individually-granted vacancy permissions --------------------------
#
# create/edit/dean-approve/hr-approve are gated by
# require_roles_or_permission: the historical role keeps its access AND a
# holder of the matching permission gets in. These four tests cover the
# second half of that OR -- the role-only half is covered by the tests above
# (test_hod_can_create_vacancy_request_for_own_campus,
# test_recruitment_officer_cannot_dean_approve, ...).


def test_coordinator_without_grants_cannot_create_or_edit(client, user_factory, department_factory):
    department = department_factory("SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, coordinator),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 403


def test_coordinator_with_create_grant_can_create_vacancy_request(
    client, user_factory, department_factory, grant_permission
):
    department = department_factory("SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_permission(coordinator, PermissionEnum.CREATE_VACANCY_REQUEST)

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, coordinator),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert response.status_code == 201
    assert response.json()["status"] == "DRAFT"


def test_coordinator_with_edit_grant_can_edit_and_submit_but_not_create(
    client, user_factory, department_factory, grant_permission
):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_permission(coordinator, PermissionEnum.EDIT_VACANCY_REQUEST)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]

    # EDIT_VACANCY_REQUEST is not CREATE_VACANCY_REQUEST -- the split is the
    # whole point of replacing the old single `_can_write` gate.
    denied = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, coordinator),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert denied.status_code == 403

    updated = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}",
        headers=auth_headers(client, coordinator),
        json={"qualification": "PhD or equivalent"},
    )
    assert updated.status_code == 200
    assert updated.json()["qualification"] == "PhD or equivalent"

    submitted = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, coordinator)
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "SUBMITTED"


def test_hr_admin_can_dean_approve_via_default_approve_vacancy_permission(
    client, user_factory, department_factory
):
    # Pins a deliberate consequence of gating dean-approve on the shared
    # APPROVE_VACANCY: HR_ADMIN holds it in DEFAULT_PERMISSIONS_BY_ROLE, so
    # an HR Admin can now perform the Dean stage. The reverse does NOT hold
    # -- see test_permission_matrix_router_enforcement.py::
    # test_associate_dean_default_approve_vacancy_permission_cannot_hr_approve.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DEAN_APPROVED"


def test_officer_with_approve_grant_can_dean_approve(
    client, user_factory, department_factory, grant_permission
):
    # The negative of test_recruitment_officer_cannot_dean_approve: the same
    # role, the same call, plus an individually granted APPROVE_VACANCY.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    grant_permission(officer, PermissionEnum.APPROVE_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, officer)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DEAN_APPROVED"


# --- Self-approval guard ------------------------------------------------
#
# app/services/vacancy_workflow.py::_reject_self_approval. Only reachable now
# that the Permission Matrix can hand APPROVE_VACANCY to a role that can also
# raise a request -- before that, approving and requesting were disjoint role
# sets and nobody could be both parties.


def test_hod_with_approve_grant_cannot_dean_approve_own_request(
    client, user_factory, department_factory, grant_permission
):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    grant_permission(hod, PermissionEnum.APPROVE_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, hod)
    )
    assert response.status_code == 403
    assert "cannot Dean-approve it yourself" in response.json()["detail"]


def test_approve_grant_still_works_on_someone_elses_request(
    client, user_factory, department_factory, grant_permission
):
    # The other half of the test above: the grant is not what is refused, the
    # actor being the requester is.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    other_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    grant_permission(other_hod, PermissionEnum.APPROVE_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, other_hod)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DEAN_APPROVED"


def test_hr_admin_cannot_hr_approve_own_request(
    client, user_factory, department_factory, grant_permission
):
    department = department_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    grant_permission(hr_admin, PermissionEnum.CREATE_VACANCY_REQUEST)
    grant_permission(hr_admin, PermissionEnum.EDIT_VACANCY_REQUEST)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hr_admin),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hr_admin))
    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 403
    assert "cannot HR-approve it yourself" in response.json()["detail"]


def test_super_admin_is_exempt_from_the_self_approval_guard(client, user_factory, department_factory):
    # The break-glass exemption, and the reason a large part of this suite
    # still passes: it drives create -> submit -> hr-approve as one actor.
    department = department_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, super_admin),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, super_admin))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, super_admin)
    )
    assert response.status_code == 200


@pytest.mark.parametrize("source", ["BULK_UPLOAD", "QR"])
def test_uploader_and_intake_account_are_exempt_from_the_self_approval_guard(
    client, user_factory, department_factory, db_session, grant_permission, source
):
    # On these two sources `requested_by_id` is an attribution, not the person
    # who asked: the uploader for BULK_UPLOAD, the intake account for QR.
    # Guarding them would lock HR out of every request they uploaded on a
    # department's behalf.
    department = department_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    grant_permission(hr_admin, PermissionEnum.CREATE_VACANCY_REQUEST)
    grant_permission(hr_admin, PermissionEnum.EDIT_VACANCY_REQUEST)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hr_admin),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    # Faster and more direct than driving the whole importer or the public QR
    # endpoint -- the guard reads `source` and nothing else about the origin.
    vr = db_session.get(VacancyRequest, uuid.UUID(vr_id))
    vr.source = VacancyRequestSourceEnum[source]
    db_session.flush()

    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hr_admin))
    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200


def test_wrong_status_still_answers_409_for_the_requester(
    client, user_factory, department_factory, grant_permission
):
    # The guard runs AFTER each stage's status check, so a DRAFT request keeps
    # its more informative 409 instead of flipping to 403 for its own author.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    grant_permission(hod, PermissionEnum.APPROVE_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, hod)
    )
    assert response.status_code == 409


# --- Raised by ----------------------------------------------------------


def test_requested_by_name_falls_back_to_the_requesting_user(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert create.json()["requested_by_name"] == hod.full_name


def test_requested_by_name_prefers_requester_name_when_set(
    client, user_factory, department_factory, db_session
):
    # A QR row is attributed to the intake account, so the person named on the
    # row itself wins -- that is what an approver needs to see.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    vr = db_session.get(VacancyRequest, uuid.UUID(vr_id))
    vr.source = VacancyRequestSourceEnum.QR
    vr.requester_name = "Dr Ramesh Kumar"
    db_session.flush()

    read = client.get(f"/api/v1/vacancy-requests/{vr_id}", headers=auth_headers(client, hod))
    assert read.json()["requested_by_name"] == "Dr Ramesh Kumar"


# --- Cancel ------------------------------------------------------------


def test_cancel_from_submitted_succeeds(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Position no longer needed"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "CANCELLED"
    assert body["cancellation_reason"] == "Position no longer needed"
    assert body["cancelled_at"] is not None
    assert body["cancelled_by_id"] == str(hr_admin.id)


def test_cancel_from_published_succeeds(client, user_factory, published_vacancy_factory, db_session):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Budget freeze"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"

    db_session.refresh(vacancy.approved_vacancy)
    db_session.refresh(vacancy.job_posting)
    assert vacancy.approved_vacancy.closed_at is not None
    assert vacancy.job_posting.closed_at is not None
    assert vacancy.job_posting.is_active is False


def test_cancel_blocked_when_slot_committed(
    client, user_factory, published_vacancy_factory, application_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "No longer needed"},
    )
    assert response.status_code == 409
    assert "reserved or filled" in response.json()["detail"]


def test_cancel_blocked_from_closed_status(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Too late"},
    )
    assert response.status_code == 409


def test_close_deletes_stale_open_hiring_slots(client, user_factory, published_vacancy_factory, db_session):
    """A force-close (HR deciding these posts are no longer needed) used to
    leave every still-OPEN HiringSlot dangling forever, silently inflating
    the dashboard's open_positions/closure-rate numbers for a vacancy that's
    no longer actually recruiting -- see close()'s own comment."""
    from app.models.hiring_slot import HiringSlot

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200

    remaining = (
        db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id).all()
    )
    assert remaining == []


def test_close_preserves_reserved_hiring_slots(
    client, user_factory, published_vacancy_factory, application_factory, db_session
):
    """A RESERVED slot has a real candidate mid-pipeline -- close() must not
    silently delete it out from under them, only the still-untouched OPEN
    ones."""
    from app.models.hiring_slot import HiringSlot
    from app.models.enums import HiringSlotStatusEnum

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200

    remaining = (
        db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id).all()
    )
    assert len(remaining) == 1
    assert remaining[0].status == HiringSlotStatusEnum.RESERVED


def test_cancel_blocked_from_rejected_status(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, dean),
        json={"reason": "Not needed"},
    )

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Too late"},
    )
    assert response.status_code == 409


def test_cancel_blocked_from_already_cancelled_status(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()

    first = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "First cancel"},
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, hr_admin),
        json={"reason": "Second cancel"},
    )
    assert second.status_code == 409


def test_cancel_forbidden_for_campus_hod(client, user_factory, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, vacancy.hod),
        json={"reason": "Not needed"},
    )
    assert response.status_code == 403


def test_cancel_forbidden_for_recruitment_officer(client, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"reason": "Not needed"},
    )
    assert response.status_code == 403


# --- Slot count adjustment ----------------------------------------------


def test_slot_count_increase_adds_open_slots(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 4},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 4

    slots = client.get(
        f"/api/v1/approved-vacancies/{vacancy.approved_vacancy.id}/hiring-slots",
        headers=auth_headers(client, hr_admin),
    )
    assert slots.json()["total"] == 4
    assert all(s["status"] == "OPEN" for s in slots.json()["items"])

    vr_detail = client.get(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}", headers=auth_headers(client, hr_admin)
    )
    assert vr_detail.json()["requested_count"] == 4


def test_slot_count_decrease_succeeds_with_open_headroom(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 1

    slots = client.get(
        f"/api/v1/approved-vacancies/{vacancy.approved_vacancy.id}/hiring-slots",
        headers=auth_headers(client, hr_admin),
    )
    assert slots.json()["total"] == 1


def test_slot_count_decrease_blocked_below_committed(
    client, user_factory, published_vacancy_factory, application_factory
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)
    app1 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    app2 = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, app1.id, vacancy.hr_admin, "SELECTED").status_code == 200
    assert _transition_application(client, app2.id, vacancy.hr_admin, "SELECTED").status_code == 200

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 409
    assert "2 slot(s)" in response.json()["detail"]


def test_slot_count_adjustment_to_filled_count_autocloses(
    client, user_factory, published_vacancy_factory, application_factory, db_session
):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    assert _transition_application(client, application.id, vacancy.hr_admin, "SELECTED").status_code == 200
    assert _transition_application(client, application.id, vacancy.hr_admin, "JOINED").status_code == 200

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 1},
    )
    assert response.status_code == 200
    assert response.json()["total_positions"] == 1

    vr_detail = client.get(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}", headers=auth_headers(client, hr_admin)
    )
    assert vr_detail.json()["status"] == "CLOSED"

    db_session.refresh(vacancy.approved_vacancy)
    db_session.refresh(vacancy.job_posting)
    assert vacancy.approved_vacancy.closed_at is not None
    assert vacancy.job_posting.is_active is False


def test_slot_count_adjustment_blocked_after_close(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, hr_admin)
    )

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 5},
    )
    assert response.status_code == 409
    assert "approved or published" in response.json()["detail"]


def test_slot_count_adjustment_requires_approved_vacancy(client, user_factory, department_factory):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]

    response = client.patch(
        f"/api/v1/vacancy-requests/{vr_id}/slot-count",
        headers=auth_headers(client, hr_admin),
        json={"requested_count": 5},
    )
    assert response.status_code == 409
    assert "has not been approved" in response.json()["detail"]


def test_slot_count_adjustment_forbidden_for_campus_hod(client, published_vacancy_factory):
    vacancy = published_vacancy_factory()

    response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, vacancy.hod),
        json={"requested_count": 5},
    )
    assert response.status_code == 403


# --- Approved-vacancy filter ---------------------------------------------


# --- RECRUITMENT_COORDINATOR RBAC (capability-gated) ----------------------


def test_recruitment_coordinator_without_grant_forbidden_on_all_vacancy_approval_actions(
    client, user_factory, department_factory, published_vacancy_factory
):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    reject_response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, coordinator),
        json={"reason": "Not needed"},
    )
    assert reject_response.status_code == 403

    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))
    hr_approve_response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, coordinator)
    )
    assert hr_approve_response.status_code == 403

    vacancy = published_vacancy_factory(slot_count=2)
    close_response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, coordinator)
    )
    assert close_response.status_code == 403
    cancel_response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/cancel",
        headers=auth_headers(client, coordinator),
        json={"reason": "Budget freeze"},
    )
    assert cancel_response.status_code == 403
    slot_response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/slot-count",
        headers=auth_headers(client, coordinator),
        json={"requested_count": 4},
    )
    assert slot_response.status_code == 403


def test_recruitment_coordinator_with_vacancy_approval_grant_can_reject(
    client, user_factory, department_factory, grant_coordinator_capability, grant_permission
):
    # Both grants inserted directly -- CoordinatorCapabilityGrant (still
    # real, independently consulted for the untouched dean-approve/
    # hr-approve/slot-count endpoints) plus the UserPermissionGrant this
    # endpoint actually checks now (require_permission(REJECT_VACANCY)),
    # mirroring what a real coordinator would have post-migration-backfill
    # (e5a4d57be056 maps VACANCY_APPROVAL onto APPROVE_VACANCY/
    # REJECT_VACANCY/PUBLISH_VACANCY/CLOSE_VACANCY/CANCEL_VACANCY) -- the
    # test DB never runs that migration, so both are inserted directly.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.VACANCY_APPROVAL)
    grant_permission(coordinator, PermissionEnum.REJECT_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, coordinator),
        json={"reason": "Not needed"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"


def test_recruitment_coordinator_with_vacancy_approval_grant_can_hr_approve_and_publish(
    client, user_factory, department_factory, grant_coordinator_capability, grant_permission
):
    # hr-approve stays on the old CoordinatorCapabilityGrant-only gate
    # (untouched by this phase), but publish now checks
    # require_permission(PUBLISH_VACANCY) -- grant both so this test reflects
    # real post-migration-backfill coordinator state (see the sibling
    # can_reject test's comment for the full rationale).
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.VACANCY_APPROVAL)
    grant_permission(coordinator, PermissionEnum.PUBLISH_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))
    client.post(f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, dean))

    hr_approved = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/hr-approve", headers=auth_headers(client, coordinator)
    )
    assert hr_approved.status_code == 200

    published = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/publish", headers=auth_headers(client, coordinator)
    )
    assert published.status_code == 200
    assert published.json()["is_active"] is True


def test_recruitment_coordinator_with_vacancy_approval_grant_can_close_cancel_and_adjust_slot_count(
    client, user_factory, published_vacancy_factory, grant_coordinator_capability, grant_permission
):
    # close/cancel now check require_permission(CLOSE_VACANCY)/
    # (CANCEL_VACANCY); slot-count stays on the old CoordinatorCapabilityGrant-
    # only gate (untouched by this phase). Grant both systems so this test
    # reflects real post-migration-backfill coordinator state (see
    # can_reject's comment above for the full rationale).
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    grant_coordinator_capability(coordinator, CoordinatorCapabilityEnum.VACANCY_APPROVAL)
    grant_permission(coordinator, PermissionEnum.CLOSE_VACANCY)
    grant_permission(coordinator, PermissionEnum.CANCEL_VACANCY)
    vacancy_a = published_vacancy_factory(slot_count=2)
    vacancy_b = published_vacancy_factory(slot_count=2)
    vacancy_c = published_vacancy_factory(slot_count=2)

    close_response = client.post(
        f"/api/v1/vacancy-requests/{vacancy_a.vacancy_request.id}/close",
        headers=auth_headers(client, coordinator),
    )
    assert close_response.status_code == 200
    assert close_response.json()["status"] == "CLOSED"

    cancel_response = client.post(
        f"/api/v1/vacancy-requests/{vacancy_b.vacancy_request.id}/cancel",
        headers=auth_headers(client, coordinator),
        json={"reason": "Budget freeze"},
    )
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "CANCELLED"

    slot_response = client.patch(
        f"/api/v1/vacancy-requests/{vacancy_c.vacancy_request.id}/slot-count",
        headers=auth_headers(client, coordinator),
        json={"requested_count": 4},
    )
    assert slot_response.status_code == 200
    assert slot_response.json()["total_positions"] == 4


def test_recruitment_coordinator_cannot_dean_approve(client, user_factory, department_factory):
    # Dean-approval is deliberately excluded from this role's grant -- it
    # remains ASSOCIATE_DEAN_RECRUITMENT/SUPER_ADMIN only.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/dean-approve", headers=auth_headers(client, coordinator)
    )
    assert response.status_code == 403


def test_list_approved_vacancies_filters_by_vacancy_request_id(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy_a = published_vacancy_factory()
    vacancy_b = published_vacancy_factory()

    response = client.get(
        "/api/v1/approved-vacancies",
        headers=auth_headers(client, hr_admin),
        params={"vacancy_request_id": str(vacancy_a.vacancy_request.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(vacancy_a.approved_vacancy.id)


# --- department_id/designation_id filters on list (Phase H, glowing-zooming-hamming.md) ---


def test_list_vacancy_requests_filters_by_department_id(client, user_factory, department_factory):
    department_a = department_factory("SSE", "Department A")
    department_b = department_factory("SSE", "Department B")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create_a = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department_a.id, campus_id=str(department_a.campus_id)),
    )
    assert create_a.status_code == 201
    client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department_b.id, campus_id=str(department_b.campus_id)),
    )

    response = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        params={"department_id": str(department_a.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == create_a.json()["id"]
    assert all(item["department_id"] == str(department_a.id) for item in body["items"])


def test_list_vacancy_requests_filters_by_designation_id(
    client, user_factory, department_factory, designation_factory
):
    department = department_factory("SSE")
    designation_a = designation_factory(department=department)
    designation_b = designation_factory(department=department)
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create_a = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(
            department.id, campus_id=str(department.campus_id), designation_id=str(designation_a.id)
        ),
    )
    assert create_a.status_code == 201
    client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(
            department.id, campus_id=str(department.campus_id), designation_id=str(designation_b.id)
        ),
    )

    response = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        params={"designation_id": str(designation_a.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == create_a.json()["id"]


def test_list_vacancy_requests_filters_combine_department_and_designation_id(
    client, user_factory, department_factory, designation_factory
):
    department_a = department_factory("SSE", "Department A")
    department_b = department_factory("SSE", "Department B")
    # designation_id on VacancyRequest is a plain FK, independent of
    # Designation's own department M2M -- created with no department binding
    # at all so it's usable against either department below without touching
    # that unrelated relationship.
    designation = designation_factory()
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create_a = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(
            department_a.id, campus_id=str(department_a.campus_id), designation_id=str(designation.id)
        ),
    )
    assert create_a.status_code == 201
    create_b = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(
            department_b.id, campus_id=str(department_b.campus_id), designation_id=str(designation.id)
        ),
    )
    assert create_b.status_code == 201

    # Same designation_id spans both requests, but department_id narrows to
    # exactly the one raised against department_a -- combined AND, not OR.
    response = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        params={"department_id": str(department_a.id), "designation_id": str(designation.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == create_a.json()["id"]


def test_list_vacancy_requests_status_filter_still_works_alongside_new_filters(
    client, user_factory, department_factory
):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    create_draft = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    assert create_draft.status_code == 201

    create_submitted = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    submitted_id = create_submitted.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{submitted_id}/submit", headers=auth_headers(client, hod))

    response = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        params={"status": "DRAFT", "department_id": str(department.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == create_draft.json()["id"]

    response_submitted = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        params={"status": "SUBMITTED", "department_id": str(department.id)},
    )
    assert response_submitted.json()["total"] == 1
    assert response_submitted.json()["items"][0]["id"] == submitted_id


def test_list_vacancy_requests_campus_scope_isolation_holds_with_new_filters(
    client, user_factory, department_factory
):
    department_sse = department_factory("SSE")
    department_scad = department_factory("SCAD")
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_sse),
        json=_create_payload(department_sse.id, campus_id=str(department_sse.campus_id)),
    )
    other_campus_create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_scad),
        json=_create_payload(department_scad.id, campus_id=str(department_scad.campus_id)),
    )
    assert other_campus_create.status_code == 201

    # hod_sse is campus-scoped to SSE; even without a department_id filter,
    # SCAD's vacancy request must never appear for them.
    response = client.get("/api/v1/vacancy-requests", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert other_campus_create.json()["id"] not in ids

    # Passing the other campus's own department_id doesn't leak it either --
    # campus scope narrows the base query before department_id is applied.
    response_with_filter = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_sse),
        params={"department_id": str(department_scad.id)},
    )
    assert response_with_filter.status_code == 200
    assert response_with_filter.json()["total"] == 0


def test_super_admin_department_id_filter_is_global_across_campuses(client, user_factory, department_factory):
    department_sse = department_factory("SSE")
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod_sse),
        json=_create_payload(department_sse.id, campus_id=str(department_sse.campus_id)),
    )
    assert create.status_code == 201

    response = client.get(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, super_admin),
        params={"department_id": str(department_sse.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == create.json()["id"]


# --- intake fields on the authenticated create/update (2026-09-02) -----------
#
# `VacancyRequestCreate` has accepted `location_id` and `required_by` since
# 2026-08-30, and BOTH were silently dropped: the create endpoint's
# VacancyRequest(...) constructor never assigned them and the update
# endpoint's applied-field tuple never listed them. The wizard had been
# sending both all along, which is why every in-app request carried a NULL
# location_id. These tests are the regression guard.


def test_create_persists_location_and_required_by(
    client, user_factory, department_factory, location_factory, db_session
):
    department = department_factory("SSE")
    location = location_factory("SSE", name="Circular Building", floor_venue="Ground Floor")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    db_session.commit()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(
            department.id,
            campus_id=str(hod.campus_id),
            location_id=str(location.id),
            required_by="2026-12-31",
        ),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["location_id"] == str(location.id)
    assert body["required_by"] == "2026-12-31"
    vr = db_session.get(VacancyRequest, uuid.UUID(body["id"]))
    db_session.refresh(vr)
    assert vr.location_id == location.id
    assert str(vr.required_by) == "2026-12-31"


def test_update_persists_a_changed_location(
    client, user_factory, department_factory, location_factory, db_session
):
    department = department_factory("SSE")
    first = location_factory("SSE", name="Block A")
    second = location_factory("SSE", name="Block B")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    db_session.commit()

    created = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(hod.campus_id), location_id=str(first.id)),
    ).json()

    response = client.patch(
        f"/api/v1/vacancy-requests/{created['id']}",
        headers=auth_headers(client, hod),
        json={"location_id": str(second.id)},
    )

    assert response.status_code == 200, response.text
    assert response.json()["location_id"] == str(second.id)


def test_create_requires_a_location_when_the_campus_has_any(
    client, user_factory, department_factory, location_factory, db_session
):
    department = department_factory("SSE")
    location_factory("SSE", name="Some Block")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    db_session.commit()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(hod.campus_id)),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Location is required for this campus."


def test_create_allows_no_location_when_the_campus_has_none(
    client, user_factory, department_factory, db_session
):
    """Five of seven production campuses have zero locations; a flat
    requirement would have made vacancy creation impossible on all five."""
    department = department_factory("SCAD")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")
    db_session.commit()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(hod.campus_id)),
    )

    assert response.status_code == 201, response.text
    assert response.json()["location_id"] is None


def test_create_rejects_a_location_from_another_campus(
    client, user_factory, department_factory, location_factory, db_session
):
    """The authenticated path previously validated location NOT AT ALL, so a
    caller could attach another campus's room to a request."""
    department = department_factory("SSE")
    location_factory("SSE", name="Home Block")
    foreign = location_factory("SCAD", name="Other Campus Block")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    db_session.commit()

    response = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(hod.campus_id), location_id=str(foreign.id)),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Location does not belong to the selected campus."


def test_requester_cannot_reject_own_request(client, user_factory, department_factory, grant_permission):
    # Audit L1: the guard covered both approve stages but not reject.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    grant_permission(hod, PermissionEnum.REJECT_VACANCY)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, hod),
        json={"reason": "changed my mind"},
    )
    assert response.status_code == 403
    assert "cannot reject it yourself" in response.json()["detail"]


def test_someone_else_can_still_reject(client, user_factory, department_factory, grant_permission):
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, dean),
        json={"reason": "not sanctioned this year"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "REJECTED"


def test_user_without_reject_permission_still_cannot_reject(client, user_factory, department_factory):
    # D: the self-action guard sits BEHIND the permission gate, which is unchanged.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    other_hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")  # no REJECT_VACANCY grant

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, other_hod),
        json={"reason": "not mine to reject"},
    )
    assert response.status_code == 403
    assert "cannot reject it yourself" not in response.json()["detail"]


def test_super_admin_may_reject_own_request(client, user_factory, department_factory):
    # E: the break-glass exemption is the same for reject as for the approve stages.
    department = department_factory("SSE")
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, admin),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, admin))

    response = client.post(
        f"/api/v1/vacancy-requests/{vr_id}/reject",
        headers=auth_headers(client, admin),
        json={"reason": "withdrawn by admin"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "REJECTED"


def test_self_reject_guard_does_not_bypass_the_reason_requirement(
    client, user_factory, department_factory, grant_permission
):
    # F: an empty reason is still refused as a validation error (the rule is
    # unchanged: min_length=1), and it is refused BEFORE the self-action guard
    # runs -- the requester gets the same 422 as anyone else, never a 403.
    department = department_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    grant_permission(hod, PermissionEnum.REJECT_VACANCY)
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)

    create = client.post(
        "/api/v1/vacancy-requests",
        headers=auth_headers(client, hod),
        json=_create_payload(department.id, campus_id=str(department.campus_id)),
    )
    vr_id = create.json()["id"]
    client.post(f"/api/v1/vacancy-requests/{vr_id}/submit", headers=auth_headers(client, hod))

    for actor in (dean, hod):
        response = client.post(
            f"/api/v1/vacancy-requests/{vr_id}/reject", headers=auth_headers(client, actor), json={"reason": ""}
        )
        assert response.status_code == 422, actor.role
