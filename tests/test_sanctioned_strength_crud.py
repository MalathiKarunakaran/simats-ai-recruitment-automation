"""CRUD + history tests for the SanctionedStrength router
(app/api/v1/routers/sanctioned_strength.py, zany-snuggling-pie.md Phase B,
item 3). Model/round-trip and current-effective-row resolver tests live in
tests/test_sanctioned_strength.py (Phase A, predates this router);
designation-breakdown-endpoint tests live in tests/test_vacancy_register.py
(colocated with app/api/v1/routers/vacancy_register.py, which serves it).
"""

import uuid
from datetime import date

from app.models.enums import SanctionedStrengthChangeSourceEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength, SanctionedStrengthHistory

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/sanctioned-strength"


def _create(client, actor, **overrides):
    payload = {
        "campus_id": str(overrides["campus_id"]),
        "department_id": str(overrides["department_id"]),
        "designation_id": str(overrides["designation_id"]),
        "approved_strength": overrides.get("approved_strength", 5),
        "effective_from": str(overrides.get("effective_from", date.today())),
        "remarks": overrides.get("remarks"),
    }
    if "location_id" in overrides:
        payload["location_id"] = str(overrides["location_id"]) if overrides["location_id"] is not None else None
    return client.post(ENDPOINT, json=payload, headers=auth_headers(client, actor))


def test_create_success_writes_history_and_audit_log(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Create Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        approved_strength=6,
        remarks="Initial sanction",
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["approved_strength"] == 6
    assert body["category"] == "TEACHING"
    assert body["is_active"] is True
    assert body["created_by_id"] == str(hr_admin.id)
    assert body["updated_by_id"] is None

    history = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == uuid.UUID(body["id"]))
        .all()
    )
    assert len(history) == 1
    assert history[0].old_value is None
    assert history[0].new_value == 6
    assert history[0].source == SanctionedStrengthChangeSourceEnum.MANUAL


def test_create_category_mismatch_is_400(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Mismatch Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.NON_TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client, hr_admin, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert response.status_code == 400
    assert "does not support" in response.json()["detail"].lower()


def test_create_unknown_department_is_400(client, campus_factory, designation_factory, user_factory):
    campus = campus_factory("SSE")
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client, hr_admin, campus_id=campus.id, department_id=uuid.uuid4(), designation_id=designation.id
    )
    assert response.status_code == 400


def test_create_negative_approved_strength_is_422(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Negative Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        approved_strength=-1,
    )
    assert response.status_code == 422


def test_create_forbidden_for_non_write_role(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Forbidden Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = _create(
        client, hod, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert response.status_code == 403


def test_patch_updates_approved_strength_and_writes_history(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Patch Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"approved_strength": 8}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["approved_strength"] == 8
    assert body["updated_by_id"] == str(hr_admin.id)

    history = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .order_by(SanctionedStrengthHistory.changed_at.desc())
        .all()
    )
    assert len(history) == 1
    assert history[0].old_value == 5
    assert history[0].new_value == 8
    assert history[0].source == SanctionedStrengthChangeSourceEnum.MANUAL


def test_patch_same_approved_strength_writes_no_history(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"NoChange Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"approved_strength": 5}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200

    history = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .all()
    )
    assert len(history) == 0


def test_patch_remarks_only_writes_no_history(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"RemarksOnly Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"remarks": "Revised headcount plan"}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["remarks"] == "Revised headcount plan"
    assert response.json()["approved_strength"] == 5

    history = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .all()
    )
    assert len(history) == 0


def test_patch_forbidden_for_non_write_role(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"PatchForbidden Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.patch(
        f"{ENDPOINT}/{row.id}", json={"approved_strength": 8}, headers=auth_headers(client, hod)
    )
    assert response.status_code == 403


def test_patch_unknown_id_is_404(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.patch(
        f"{ENDPOINT}/{uuid.uuid4()}", json={"approved_strength": 8}, headers=auth_headers(client, hr_admin)
    )
    assert response.status_code == 404


def test_delete_soft_deletes_when_no_active_employees(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Delete Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    response = client.delete(f"{ENDPOINT}/{row.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 204, response.text

    db_session.refresh(row)
    assert row.is_active is False
    assert row.updated_by_id == hr_admin.id


def test_delete_blocked_when_active_employees_exist(
    client, published_vacancy_factory, hired_employee_factory, designation_factory, sanctioned_strength_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    hired = hired_employee_factory(vacancy)

    designation = designation_factory(department=vacancy.department)
    hired.employee.designation_id = designation.id
    db_session.flush()

    row = sanctioned_strength_factory(
        campus=vacancy.campus,
        department=vacancy.department,
        designation=designation,
        approved_strength=2,
        created_by=vacancy.hr_admin,
    )
    db_session.commit()

    response = client.delete(f"{ENDPOINT}/{row.id}", headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 409
    assert "1" in response.json()["detail"]

    db_session.refresh(row)
    assert row.is_active is True


def test_delete_forbidden_for_non_write_role(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"DeleteForbidden Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.delete(f"{ENDPOINT}/{row.id}", headers=auth_headers(client, hod))
    assert response.status_code == 403


def test_history_endpoint_returns_paginated_newest_first(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"History Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()

    for new_value in (6, 7, 8):
        response = client.patch(
            f"{ENDPOINT}/{row.id}", json={"approved_strength": new_value}, headers=auth_headers(client, hr_admin)
        )
        assert response.status_code == 200

    # All 3 PATCHes land in the same outer test transaction, and Postgres's
    # NOW() resolves to transaction-start time (not statement time), so
    # every history row's server-default changed_at is identical here --
    # stagger it explicitly to prove the endpoint's ORDER BY actually orders
    # newest-first, rather than relying on incidental insertion order (which
    # would only coincidentally look right).
    from datetime import datetime, timedelta, timezone

    history_rows = (
        db_session.query(SanctionedStrengthHistory)
        .filter(SanctionedStrengthHistory.sanctioned_strength_id == row.id)
        .order_by(SanctionedStrengthHistory.new_value)
        .all()
    )
    base = datetime.now(timezone.utc)
    for offset, history_row in enumerate(history_rows):
        history_row.changed_at = base + timedelta(minutes=offset)
    db_session.flush()

    response = client.get(f"{ENDPOINT}/{row.id}/history", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    new_values = [item["new_value"] for item in body["items"]]
    assert new_values == [8, 7, 6]


def test_history_read_allowed_for_any_staff_role(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"StaffRead Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.get(f"{ENDPOINT}/{row.id}/history", headers=auth_headers(client, hod))
    assert response.status_code == 200


def test_history_candidate_forbidden(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"CandidateForbidden Dept {uuid.uuid4().hex[:6]}")
    designation = designation_factory(department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=campus, department=department, designation=designation, approved_strength=5, created_by=hr_admin
    )
    db_session.commit()
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    response = client.get(f"{ENDPOINT}/{row.id}/history", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_history_cross_campus_is_404_for_single_campus_role(
    client, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory, db_session
):
    campus_factory("SSE")
    other_campus = campus_factory("SCAD")
    other_department = department_factory("SCAD", name=f"Other Campus Dept {uuid.uuid4().hex[:6]}")
    other_designation = designation_factory(department=other_department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = sanctioned_strength_factory(
        campus=other_campus,
        department=other_department,
        designation=other_designation,
        approved_strength=5,
        created_by=hr_admin,
    )
    db_session.commit()
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.get(f"{ENDPOINT}/{row.id}/history", headers=auth_headers(client, hod_sse))
    assert response.status_code == 404


# --- Phase C (glowing-zooming-hamming.md): location_id wiring ---------------------------------------


def test_create_housekeeping_without_location_id_is_400(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Housekeeping Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.HOUSEKEEPING]
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client, hr_admin, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert response.status_code == 400
    assert "location" in response.json()["detail"].lower()


def test_create_housekeeping_with_location_id_succeeds(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Housekeeping Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.HOUSEKEEPING]
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    location = Location(campus_id=campus.id, name="Block A")
    db_session.add(location)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=location.id,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["location_id"] == str(location.id)


def test_create_unknown_location_id_is_400(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Unknown Location Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=uuid.uuid4(),
    )
    assert response.status_code == 400
    assert "location" in response.json()["detail"].lower()


def test_create_teaching_without_location_id_still_succeeds(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"Teaching NoLoc Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client, hr_admin, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert response.status_code == 201, response.text
    assert response.json()["location_id"] is None


def test_create_non_teaching_without_location_id_still_succeeds(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"NonTeaching NoLoc Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.NON_TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, department=department)
    db_session.flush()
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client, hr_admin, campus_id=campus.id, department_id=department.id, designation_id=designation.id
    )
    assert response.status_code == 201, response.text
    assert response.json()["location_id"] is None


# --- Location is filtered by CAMPUS, never by category (2026-09-01) ---------
#
# The reported bug was the Edit drawer showing "Select a location" over an
# empty list for a NON_TEACHING designation. Root cause was a category filter
# on the picker, and production has 23 locations of which every single one is
# categorised TEACHING -- so Non-Teaching and Housekeeping rows matched
# nothing. These pin the backend half: a Location is a physical place, so its
# category must never gate which rows may reference it, while its CAMPUS must.


def _location(db_session, campus, name="Block A", category=None):
    location = Location(campus_id=campus.id, name=name, category=category)
    db_session.add(location)
    db_session.flush()
    return location


def test_non_teaching_row_accepts_a_teaching_categorised_location(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    """The exact production shape: every location is TEACHING, the designation
    is NON_TEACHING. This must be accepted, not rejected."""
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"NT Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.NON_TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, department=department)
    location = _location(db_session, campus, category=StaffRoleCategoryEnum.TEACHING)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=location.id,
    )
    assert response.status_code == 201, response.text
    assert response.json()["location_id"] == str(location.id)


def test_teaching_row_accepts_a_location_with_no_category_at_all(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"T Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    location = _location(db_session, campus, category=None)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=location.id,
    )
    assert response.status_code == 201, response.text


def test_housekeeping_row_accepts_a_teaching_categorised_location(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    """Housekeeping is the one category where a location is REQUIRED, so a
    category filter here did not merely hide options -- it made the row
    impossible to save at all."""
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"HK Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.HOUSEKEEPING]
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    location = _location(db_session, campus, category=StaffRoleCategoryEnum.TEACHING)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=location.id,
    )
    assert response.status_code == 201, response.text


def test_create_rejects_a_location_from_another_campus(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    """Campus IS a real containment relationship, and was previously
    unchecked -- a caller could attach another campus's room to a row that the
    UI would then never offer as an option."""
    campus = campus_factory("SSE")
    other_campus = campus_factory("SCAD")
    department = department_factory("SSE", name=f"XCampus Dept {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    foreign_location = _location(db_session, other_campus, name="SCAD Block")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=foreign_location.id,
    )
    assert response.status_code == 400
    assert "different campus" in response.json()["detail"].lower()


def test_update_rejects_a_location_from_another_campus(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    other_campus = campus_factory("SCAD")
    department = department_factory("SSE", name=f"XCampus Upd {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING, department=department)
    good_location = _location(db_session, campus, name="SSE Block")
    foreign_location = _location(db_session, other_campus, name="SCAD Block")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    created = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=good_location.id,
    )
    assert created.status_code == 201, created.text
    row_id = created.json()["id"]

    response = client.patch(
        f"{ENDPOINT}/{row_id}",
        json={"location_id": str(foreign_location.id)},
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 400
    assert "different campus" in response.json()["detail"].lower()

    # And the row keeps the location it had -- a rejected update must not
    # half-apply. Checked against the DB because this router has no
    # single-row GET.
    db_session.expire_all()
    assert db_session.get(SanctionedStrength, uuid.UUID(row_id)).location_id == good_location.id


def test_update_to_a_same_campus_location_of_a_different_category_succeeds(
    client, campus_factory, department_factory, designation_factory, user_factory, db_session
):
    campus = campus_factory("SSE")
    department = department_factory("SSE", name=f"NT Upd {uuid.uuid4().hex[:6]}")
    department.supported_categories = [StaffRoleCategoryEnum.NON_TEACHING]
    designation = designation_factory(StaffRoleCategoryEnum.NON_TEACHING, department=department)
    first = _location(db_session, campus, name="First Block", category=StaffRoleCategoryEnum.TEACHING)
    second = _location(db_session, campus, name="Second Block", category=StaffRoleCategoryEnum.TEACHING)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    created = _create(
        client,
        hr_admin,
        campus_id=campus.id,
        department_id=department.id,
        designation_id=designation.id,
        location_id=first.id,
    )
    assert created.status_code == 201, created.text

    response = client.patch(
        f"{ENDPOINT}/{created.json()['id']}",
        json={"location_id": str(second.id)},
        headers=auth_headers(client, hr_admin),
    )
    assert response.status_code == 200, response.text
    assert response.json()["location_id"] == str(second.id)
