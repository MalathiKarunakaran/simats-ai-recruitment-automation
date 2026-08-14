"""CRUD + RBAC + campus-scope tests for the HousekeepingStaff router
(app/api/v1/routers/housekeeping_staff.py, glowing-zooming-hamming.md Phase
D). Structurally mirrors tests/test_locations.py -- the closest existing
template for a campus-scoped, soft-delete master-data router.
"""

import uuid

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.housekeeping_staff import HousekeepingStaff

from tests.conftest import auth_headers

ENDPOINT = "/api/v1/housekeeping-staff"


def _housekeeping_designation(designation_factory, department=None):
    return designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)


def _payload(campus, designation, location, **overrides):
    payload = {
        "campus_id": str(campus.id),
        "bio_id": overrides.pop("bio_id", f"BIO-{uuid.uuid4().hex[:8]}"),
        "name": overrides.pop("name", "Jane Housekeeper"),
        "designation_id": str(designation.id),
        "location_id": str(location.id),
        "shift": overrides.pop("shift", "MORNING"),
    }
    payload.update(overrides)
    return payload


# --- RBAC --------------------------------------------------------------


def test_hod_cannot_create_housekeeping_staff(client, user_factory, campus_factory, designation_factory, location_factory):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        ENDPOINT, headers=auth_headers(client, hod), json=_payload(sse, designation, location)
    )
    assert response.status_code == 403


def test_recruitment_officer_cannot_create_housekeeping_staff(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    # Deliberate deviation from locations.py's own _WRITE_ROLES: this router
    # reuses SANCTIONED_STRENGTH_WRITE_ROLES exactly (SUPER_ADMIN/HR_ADMIN
    # only), NOT the broader RECRUITMENT_OFFICER-inclusive set locations.py
    # itself uses.
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.post(
        ENDPOINT, headers=auth_headers(client, officer), json=_payload(sse, designation, location)
    )
    assert response.status_code == 403


def test_hr_admin_can_create_housekeeping_staff(client, user_factory, campus_factory, designation_factory, location_factory):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        ENDPOINT,
        headers=auth_headers(client, hr_admin),
        json=_payload(sse, designation, location, block="Block A", floor_venue="Ground Floor", supervisor="Ravi Kumar"),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["campus_id"] == str(sse.id)
    assert body["designation_id"] == str(designation.id)
    assert body["location_id"] == str(location.id)
    assert body["block"] == "Block A"
    assert body["floor_venue"] == "Ground Floor"
    assert body["supervisor"] == "Ravi Kumar"
    assert body["shift"] == "MORNING"
    assert body["is_active"] is True
    assert body["created_by_id"] == str(hr_admin.id)
    assert body["updated_by_id"] is None


def test_super_admin_can_create_housekeeping_staff(client, user_factory, campus_factory, designation_factory, location_factory):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.post(
        ENDPOINT, headers=auth_headers(client, super_admin), json=_payload(sse, designation, location)
    )
    assert response.status_code == 201, response.text


def test_candidate_cannot_list_housekeeping_staff(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get(ENDPOINT, headers=auth_headers(client, candidate))
    assert response.status_code == 403


# --- Validation ----------------------------------------------------------


def test_create_rejects_non_housekeeping_designation(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    sse = campus_factory("SSE")
    designation = designation_factory(StaffRoleCategoryEnum.TEACHING)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        ENDPOINT, headers=auth_headers(client, hr_admin), json=_payload(sse, designation, location)
    )
    assert response.status_code == 400
    assert "housekeeping" in response.json()["detail"].lower()


def test_create_rejects_unknown_designation_id(client, user_factory, campus_factory, location_factory):
    sse = campus_factory("SSE")
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    payload = {
        "campus_id": str(sse.id),
        "bio_id": "BIO-UNKNOWN",
        "name": "Ghost Staff",
        "designation_id": str(uuid.uuid4()),
        "location_id": str(location.id),
        "shift": "MORNING",
    }
    response = client.post(ENDPOINT, headers=auth_headers(client, hr_admin), json=payload)
    assert response.status_code == 400


def test_create_rejects_unknown_location_id(client, user_factory, campus_factory, designation_factory):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    payload = {
        "campus_id": str(sse.id),
        "bio_id": "BIO-UNKNOWN-LOC",
        "name": "Ghost Staff",
        "designation_id": str(designation.id),
        "location_id": str(uuid.uuid4()),
        "shift": "MORNING",
    }
    response = client.post(ENDPOINT, headers=auth_headers(client, hr_admin), json=payload)
    assert response.status_code == 400
    assert "location" in response.json()["detail"].lower()


def test_create_without_location_id_is_422(client, user_factory, campus_factory, designation_factory):
    # location_id is a required (non-nullable) field on the Create schema --
    # omitting it entirely is a 422 (Pydantic validation), not a 400
    # (application-level check), unlike SanctionedStrength's own
    # HOUSEKEEPING-conditional 400 (there, location_id is genuinely optional
    # on the schema and only conditionally required at the router level).
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    payload = {
        "campus_id": str(sse.id),
        "bio_id": "BIO-NO-LOC",
        "name": "No Location Staff",
        "designation_id": str(designation.id),
        "shift": "MORNING",
    }
    response = client.post(ENDPOINT, headers=auth_headers(client, hr_admin), json=payload)
    assert response.status_code == 422


def test_create_rejects_unknown_campus_id(client, user_factory, designation_factory, location_factory):
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    payload = {
        "campus_id": str(uuid.uuid4()),
        "bio_id": "BIO-NOWHERE",
        "name": "Nowhere Staff",
        "designation_id": str(designation.id),
        "location_id": str(location.id),
        "shift": "MORNING",
    }
    response = client.post(ENDPOINT, headers=auth_headers(client, hr_admin), json=payload)
    assert response.status_code == 400


def test_bio_id_unique_per_campus_conflicts_on_create(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    first = client.post(
        ENDPOINT, headers=auth_headers(client, hr_admin), json=_payload(sse, designation, location, bio_id="BIO-DUP")
    )
    assert first.status_code == 201

    second = client.post(
        ENDPOINT, headers=auth_headers(client, hr_admin), json=_payload(sse, designation, location, bio_id="BIO-DUP")
    )
    assert second.status_code == 409
    assert "bio_id" in second.json()["detail"]


def test_bio_id_unique_is_scoped_per_campus_not_global(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    designation_sse = _housekeeping_designation(designation_factory)
    designation_scad = _housekeeping_designation(designation_factory)
    location_sse = location_factory("SSE")
    location_scad = location_factory("SCAD")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    first = client.post(
        ENDPOINT,
        headers=auth_headers(client, hr_admin),
        json=_payload(sse, designation_sse, location_sse, bio_id="BIO-SHARED"),
    )
    assert first.status_code == 201

    second = client.post(
        ENDPOINT,
        headers=auth_headers(client, hr_admin),
        json=_payload(scad, designation_scad, location_scad, bio_id="BIO-SHARED"),
    )
    assert second.status_code == 201, second.text


# --- Update / delete -------------------------------------------------------


def test_hr_admin_can_patch_and_delete(client, user_factory, campus_factory, designation_factory, location_factory):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        ENDPOINT, headers=auth_headers(client, hr_admin), json=_payload(sse, designation, location)
    )
    staff_id = create_response.json()["id"]

    patch_response = client.patch(
        f"{ENDPOINT}/{staff_id}",
        headers=auth_headers(client, hr_admin),
        json={"shift": "NIGHT", "block": "Block B"},
    )
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json()["shift"] == "NIGHT"
    assert patch_response.json()["block"] == "Block B"
    assert patch_response.json()["updated_by_id"] == str(hr_admin.id)

    delete_response = client.delete(f"{ENDPOINT}/{staff_id}", headers=auth_headers(client, hr_admin))
    assert delete_response.status_code == 204

    # is_active is a plain tri-state filter here (None = no filter, unlike
    # locations.py's own include_inactive-defaults-to-hidden convention) --
    # explicitly filter to active-only to prove the soft delete actually
    # flipped the flag.
    active_only = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "is_active": "true"}
    )
    active_ids = {item["id"] for item in active_only.json()["items"]}
    assert staff_id not in active_ids

    inactive_only = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "is_active": "false"}
    )
    match = next(item for item in inactive_only.json()["items"] if item["id"] == staff_id)
    assert match["is_active"] is False


def test_patch_rejects_switching_to_non_housekeeping_designation(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    other_designation = designation_factory(StaffRoleCategoryEnum.TEACHING)
    location = location_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        ENDPOINT, headers=auth_headers(client, hr_admin), json=_payload(sse, designation, location)
    )
    staff_id = create_response.json()["id"]

    patch_response = client.patch(
        f"{ENDPOINT}/{staff_id}",
        headers=auth_headers(client, hr_admin),
        json={"designation_id": str(other_designation.id)},
    )
    assert patch_response.status_code == 400
    assert "housekeeping" in patch_response.json()["detail"].lower()


def test_delete_unknown_id_returns_404(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.delete(f"{ENDPOINT}/{uuid.uuid4()}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 404


# --- Campus scope ------------------------------------------------------
#
# Note: SANCTIONED_STRENGTH_WRITE_ROLES (SUPER_ADMIN/HR_ADMIN) are both
# GLOBAL_SCOPE_ROLES, so -- exactly like sanctioned_strength.py's own
# PATCH/DELETE endpoints, which share this RBAC set and have no dedicated
# cross-campus-404 test of their own either -- there is no legitimately-
# authorized-but-wrong-campus write actor able to reach PATCH/DELETE's
# `enforce_campus_match` 404 branch through this router's real RBAC set (a
# global-scope role's CampusScope.is_global is always True, so the guard is
# a no-op for it). This differs from locations.py, whose write-role set
# deliberately includes the single-campus-scoped RECRUITMENT_OFFICER
# specifically to make that branch reachable/testable. `_get_or_404_scoped`
# is still applied for consistency/future-proofing (e.g. if a
# single-campus-scoped role is ever added to this write set), but campus
# scoping is exercised below via the LIST endpoint instead, which is
# `_staff_only` (reachable by single-campus roles like CAMPUS_HOD) --
# matching sanctioned_strength.py's own precedent of testing this on its
# comparable staff-only read endpoint.


def test_list_is_campus_scoped_for_hod(client, user_factory, campus_factory, designation_factory, location_factory, db_session):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    designation_sse = _housekeeping_designation(designation_factory)
    designation_scad = _housekeeping_designation(designation_factory)
    location_sse = location_factory("SSE")
    location_scad = location_factory("SCAD")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    db_session.add_all(
        [
            HousekeepingStaff(
                campus_id=sse.id,
                bio_id="BIO-SSE-SCOPE",
                name="SSE Staff",
                designation_id=designation_sse.id,
                location_id=location_sse.id,
                shift="MORNING",
                created_by_id=hr_admin.id,
            ),
            HousekeepingStaff(
                campus_id=scad.id,
                bio_id="BIO-SCAD-SCOPE",
                name="SCAD Staff",
                designation_id=designation_scad.id,
                location_id=location_scad.id,
                shift="MORNING",
                created_by_id=hr_admin.id,
            ),
        ]
    )
    db_session.flush()

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get(ENDPOINT, headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert "SSE Staff" in names
    assert "SCAD Staff" not in names


def test_hr_admin_global_scope_can_patch_any_campus_staff(
    client, user_factory, campus_factory, designation_factory, location_factory, db_session
):
    scad = campus_factory("SCAD")
    designation = _housekeeping_designation(designation_factory)
    location = location_factory("SCAD")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    row = HousekeepingStaff(
        campus_id=scad.id,
        bio_id="BIO-SCAD-2",
        name="SCAD Staff",
        designation_id=designation.id,
        location_id=location.id,
        shift="MORNING",
        created_by_id=hr_admin.id,
    )
    db_session.add(row)
    db_session.flush()

    response = client.patch(
        f"{ENDPOINT}/{row.id}", headers=auth_headers(client, hr_admin), json={"block": "Reachable"}
    )
    assert response.status_code == 200


# --- List filters --------------------------------------------------------


def test_list_filters_by_location_block_shift_and_search(
    client, user_factory, campus_factory, designation_factory, location_factory
):
    sse = campus_factory("SSE")
    designation = _housekeeping_designation(designation_factory)
    location_a = location_factory("SSE", name="Block A Location")
    location_b = location_factory("SSE", name="Block B Location")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    client.post(
        ENDPOINT,
        headers=auth_headers(client, hr_admin),
        json=_payload(sse, designation, location_a, bio_id="BIO-A", name="Alice Cleaner", block="North Wing", shift="MORNING"),
    )
    client.post(
        ENDPOINT,
        headers=auth_headers(client, hr_admin),
        json=_payload(sse, designation, location_b, bio_id="BIO-B", name="Bob Cleaner", block="South Wing", shift="NIGHT"),
    )

    by_location = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "location_id": str(location_a.id)}
    )
    assert {item["name"] for item in by_location.json()["items"]} == {"Alice Cleaner"}

    by_block = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "block": "south"}
    )
    assert {item["name"] for item in by_block.json()["items"]} == {"Bob Cleaner"}

    by_shift = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "shift": "NIGHT"}
    )
    assert {item["name"] for item in by_shift.json()["items"]} == {"Bob Cleaner"}

    by_search_name = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "search": "alice"}
    )
    assert {item["name"] for item in by_search_name.json()["items"]} == {"Alice Cleaner"}

    by_search_bio = client.get(
        ENDPOINT, headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "search": "BIO-B"}
    )
    assert {item["name"] for item in by_search_bio.json()["items"]} == {"Bob Cleaner"}
