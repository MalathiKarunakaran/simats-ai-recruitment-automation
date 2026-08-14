import uuid
from datetime import date

from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.models.location import Location
from app.models.sanctioned_strength import SanctionedStrength

from tests.conftest import auth_headers


def test_hod_cannot_create_location(client, user_factory, campus_factory):
    # Same RBAC shape as departments.py's own write gate -- CAMPUS_HOD has no
    # write access to Location master data.
    sse = campus_factory("SSE")
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")

    response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, hod),
        json={"campus_id": str(sse.id), "name": "Block A"},
    )
    assert response.status_code == 403


def test_hr_admin_can_create_location(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, hr_admin),
        json={
            "campus_id": str(sse.id),
            "name": "Main Block",
            "block_building": "Block A",
            "floor_venue": "Ground Floor",
            "category": "HOUSEKEEPING",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["campus_id"] == str(sse.id)
    assert body["name"] == "Main Block"
    assert body["block_building"] == "Block A"
    assert body["floor_venue"] == "Ground Floor"
    assert body["category"] == "HOUSEKEEPING"
    assert body["is_active"] is True


def test_recruitment_officer_can_create_location(client, user_factory, campus_factory):
    # Deliberate deviation from departments.py's _WRITE_ROLES
    # (glowing-zooming-hamming.md decision 4): RECRUITMENT_OFFICER maps onto
    # the spec's "HR Assistant" role and gets direct write access here.
    sse = campus_factory("SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, officer),
        json={"campus_id": str(sse.id), "name": "Library Block"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["name"] == "Library Block"


def test_recruitment_officer_can_patch_and_delete_location(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    create_response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, officer),
        json={"campus_id": str(sse.id), "name": "Hostel Block"},
    )
    assert create_response.status_code == 201
    location_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/locations/{location_id}",
        headers=auth_headers(client, officer),
        json={"block_building": "Block C", "category": "NON_TEACHING"},
    )
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json()["block_building"] == "Block C"
    assert patch_response.json()["category"] == "NON_TEACHING"

    delete_response = client.delete(f"/api/v1/locations/{location_id}", headers=auth_headers(client, officer))
    assert delete_response.status_code == 204


def test_other_roles_cannot_write_locations(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    for role in (
        UserRoleEnum.CAMPUS_HOD,
        UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
        UserRoleEnum.INTERVIEW_PANEL_MEMBER,
        UserRoleEnum.MANAGEMENT,
        UserRoleEnum.RECRUITMENT_COORDINATOR,
    ):
        user = user_factory(role, campus_code="SSE")
        response = client.post(
            "/api/v1/locations",
            headers=auth_headers(client, user),
            json={"campus_id": str(sse.id), "name": f"Block-{role.value}"},
        )
        assert response.status_code == 403, f"{role} unexpectedly allowed to create a location"


def test_candidate_cannot_list_locations(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/locations", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_super_admin_can_patch_location(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create_response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, super_admin),
        json={"campus_id": str(sse.id), "name": "Admin Block"},
    )
    location_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/locations/{location_id}",
        headers=auth_headers(client, super_admin),
        json={"name": "Renamed Admin Block", "floor_venue": "1st Floor"},
    )
    assert patch_response.status_code == 200, patch_response.text
    body = patch_response.json()
    assert body["name"] == "Renamed Admin Block"
    assert body["floor_venue"] == "1st Floor"


def test_location_list_is_campus_scoped_for_hod(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    db_session.add_all(
        [
            Location(campus_id=sse.id, name="SSE Block"),
            Location(campus_id=scad.id, name="SCAD Block"),
        ]
    )
    db_session.flush()

    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/locations", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert "SSE Block" in names
    assert "SCAD Block" not in names


def test_location_list_global_scope_sees_all_campuses(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    db_session.add_all(
        [
            Location(campus_id=sse.id, name="SSE Block Global"),
            Location(campus_id=scad.id, name="SCAD Block Global"),
        ]
    )
    db_session.flush()

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get("/api/v1/locations", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert "SSE Block Global" in names
    assert "SCAD Block Global" in names


def test_location_list_global_scope_can_filter_by_campus_id(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    scad = campus_factory("SCAD")
    db_session.add_all(
        [
            Location(campus_id=sse.id, name="SSE Only Block"),
            Location(campus_id=scad.id, name="SCAD Only Block"),
        ]
    )
    db_session.flush()

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(
        "/api/v1/locations", headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id)}
    )
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert "SSE Only Block" in names
    assert "SCAD Only Block" not in names


def test_location_list_filters_by_category(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    db_session.add_all(
        [
            Location(campus_id=sse.id, name="Teaching Block", category=StaffRoleCategoryEnum.TEACHING),
            Location(campus_id=sse.id, name="Housekeeping Block", category=StaffRoleCategoryEnum.HOUSEKEEPING),
        ]
    )
    db_session.flush()

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(
        "/api/v1/locations", headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "category": "TEACHING"}
    )
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"Teaching Block"}


def test_location_list_filters_by_search(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    db_session.add_all(
        [
            Location(campus_id=sse.id, name="Central Library"),
            Location(campus_id=sse.id, name="Sports Complex"),
        ]
    )
    db_session.flush()

    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.get(
        "/api/v1/locations", headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id), "search": "librar"}
    )
    assert response.status_code == 200
    names = {item["name"] for item in response.json()["items"]}
    assert names == {"Central Library"}


def test_location_without_category_is_allowed(client, user_factory, campus_factory):
    # Unlike Department.category (NOT NULL), Location.category stays
    # nullable -- a building can serve multiple staff categories.
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, hr_admin),
        json={"campus_id": str(sse.id), "name": "Mixed Use Block"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["category"] is None


def test_delete_location_is_soft_delete_and_hidden_from_default_list(client, user_factory, campus_factory):
    sse = campus_factory("SSE")
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    create_response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, hr_admin),
        json={"campus_id": str(sse.id), "name": "Soon Deleted Block"},
    )
    location_id = create_response.json()["id"]

    delete_response = client.delete(f"/api/v1/locations/{location_id}", headers=auth_headers(client, hr_admin))
    assert delete_response.status_code == 204

    default_list = client.get(
        "/api/v1/locations", headers=auth_headers(client, hr_admin), params={"campus_id": str(sse.id)}
    )
    default_ids = {item["id"] for item in default_list.json()["items"]}
    assert location_id not in default_ids

    include_inactive_list = client.get(
        "/api/v1/locations",
        headers=auth_headers(client, hr_admin),
        params={"campus_id": str(sse.id), "include_inactive": "true"},
    )
    match = next(item for item in include_inactive_list.json()["items"] if item["id"] == location_id)
    assert match["is_active"] is False


def test_hod_cannot_delete_location(client, user_factory, campus_factory, db_session):
    sse = campus_factory("SSE")
    location = Location(campus_id=sse.id, name="Guarded Block")
    db_session.add(location)
    db_session.flush()

    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.delete(f"/api/v1/locations/{location.id}", headers=auth_headers(client, hod))
    assert response.status_code == 403


def test_delete_unknown_location_returns_404(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.delete(f"/api/v1/locations/{uuid.uuid4()}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 404


def test_update_unknown_location_returns_404(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.patch(
        f"/api/v1/locations/{uuid.uuid4()}", headers=auth_headers(client, hr_admin), json={"name": "Nope"}
    )
    assert response.status_code == 404


def test_recruitment_officer_cannot_access_other_campus_location_returns_404(
    client, user_factory, campus_factory, db_session
):
    # enforce_campus_match's documented behaviour: 404, not 403, on
    # cross-campus access to a single resource -- exercised with a write-role
    # user (RECRUITMENT_OFFICER) so the request clears the RBAC gate and
    # actually reaches the campus-scope check.
    scad = campus_factory("SCAD")
    location = Location(campus_id=scad.id, name="SCAD Private Block")
    db_session.add(location)
    db_session.flush()

    officer_sse = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")
    response = client.patch(
        f"/api/v1/locations/{location.id}", headers=auth_headers(client, officer_sse), json={"name": "Hacked"}
    )
    assert response.status_code == 404


def test_create_location_rejects_unknown_campus_id(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    response = client.post(
        "/api/v1/locations",
        headers=auth_headers(client, hr_admin),
        json={"campus_id": str(uuid.uuid4()), "name": "Nowhere Block"},
    )
    assert response.status_code == 400


# --- Phase C (glowing-zooming-hamming.md): DELETE dependency guard ----------------------------------


def test_delete_location_blocked_when_active_sanctioned_strength_references_it(
    client, user_factory, campus_factory, department_factory, designation_factory, db_session
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name=f"Guarded Dept {uuid.uuid4().hex[:6]}")
    department.category = StaffRoleCategoryEnum.HOUSEKEEPING
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    location = Location(campus_id=sse.id, name="Referenced Block")
    db_session.add(location)
    db_session.flush()
    db_session.add(
        SanctionedStrength(
            campus_id=sse.id,
            department_id=department.id,
            designation_id=designation.id,
            location_id=location.id,
            category=StaffRoleCategoryEnum.HOUSEKEEPING,
            approved_strength=3,
            effective_from=date.today(),
            created_by_id=hr_admin.id,
        )
    )
    db_session.commit()

    response = client.delete(f"/api/v1/locations/{location.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 409
    assert "sanctioned-strength" in response.json()["detail"].lower()

    db_session.refresh(location)
    assert location.is_active is True


def test_delete_location_allowed_when_no_active_sanctioned_strength_references_it(
    client, user_factory, campus_factory, department_factory, designation_factory, db_session
):
    sse = campus_factory("SSE")
    department = department_factory("SSE", name=f"Unguarded Dept {uuid.uuid4().hex[:6]}")
    department.category = StaffRoleCategoryEnum.HOUSEKEEPING
    designation = designation_factory(StaffRoleCategoryEnum.HOUSEKEEPING, department=department)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    location = Location(campus_id=sse.id, name="Unreferenced Block")
    db_session.add(location)
    db_session.flush()
    # Only an inactive (soft-deleted) SanctionedStrength row references this
    # location -- must not block the delete.
    db_session.add(
        SanctionedStrength(
            campus_id=sse.id,
            department_id=department.id,
            designation_id=designation.id,
            location_id=location.id,
            category=StaffRoleCategoryEnum.HOUSEKEEPING,
            approved_strength=3,
            effective_from=date.today(),
            is_active=False,
            created_by_id=hr_admin.id,
        )
    )
    db_session.commit()

    response = client.delete(f"/api/v1/locations/{location.id}", headers=auth_headers(client, hr_admin))
    assert response.status_code == 204
