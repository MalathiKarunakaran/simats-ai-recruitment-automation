from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers


def test_super_admin_lists_users_across_all_campuses(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, admin))
    assert response.status_code == 200
    emails = {u["email"] for u in response.json()["items"]}
    assert admin.email in emails
    assert len(response.json()["items"]) >= 3


def test_associate_dean_sees_all_campuses_like_super_admin(client, user_factory):
    dean = user_factory(UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT)
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, dean))
    emails = {u["email"] for u in response.json()["items"]}
    assert hod_sse.email in emails
    assert hod_scad.email in emails


def test_hod_list_excludes_other_campus_users(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get("/api/v1/users", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    emails = {u["email"] for u in response.json()["items"]}
    assert hod_sse.email in emails
    assert hod_scad.email not in emails


def test_hod_get_cross_campus_user_returns_404_not_403(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    hod_scad = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD")

    response = client.get(f"/api/v1/users/{hod_scad.id}", headers=auth_headers(client, hod_sse))
    assert response.status_code == 404


def test_hod_get_same_campus_user_succeeds(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    officer_sse = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.get(f"/api/v1/users/{officer_sse.id}", headers=auth_headers(client, hod_sse))
    assert response.status_code == 200
    assert response.json()["email"] == officer_sse.email


def test_hod_cannot_create_users(client, user_factory):
    hod_sse = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, hod_sse),
        json={
            "email": "new.person@example.com",
            "password": "SomePass123!",
            "full_name": "New Person",
            "role": "CANDIDATE",
        },
    )
    assert response.status_code == 403


def test_super_admin_can_create_users(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "new.person@example.com",
            "password": "SomePass123!",
            "full_name": "New Person",
            "role": "CANDIDATE",
        },
    )
    assert response.status_code == 201
    assert response.json()["email"] == "new.person@example.com"


def test_a_newly_created_user_must_change_the_handover_password(client, user_factory, db_session):
    """The password an admin types when creating an account is a HANDOVER
    password -- with no N8N_BASE_URL there is no invite email, so it reaches
    its owner by message or word of mouth. It must not survive as their real
    password. Creation was the one door into the app that did not set this;
    admin_reset_password always has.
    """
    from app.models.user import User

    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    response = client.post(
        "/api/v1/users",
        headers=auth_headers(client, admin),
        json={
            "email": "new.dean@example.com",
            "password": "Handover123!",
            "full_name": "New Dean",
            "role": "ASSOCIATE_DEAN_RECRUITMENT",
        },
    )
    assert response.status_code == 201

    created = db_session.query(User).filter(User.email == "new.dean@example.com").one()
    assert created.must_change_password is True

    # They can sign in, but the app is closed to them until they comply --
    # the same 403 the forced-reset path already produced.
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "new.dean@example.com", "password": "Handover123!"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["must_change_password"] is True

    blocked = client.get("/api/v1/users", headers={"Authorization": f"Bearer {token}"})
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"

    # Setting their own password opens the app up.
    changed = client.patch(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "TheirOwnPass456!"},
    )
    assert changed.status_code == 200
    db_session.expire_all()
    assert (
        db_session.query(User).filter(User.email == "new.dean@example.com").one().must_change_password
        is False
    )


def test_candidate_cannot_list_users(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)
    response = client.get("/api/v1/users", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_no_auth_header_rejected(client):
    assert client.get("/api/v1/users").status_code == 401


def test_tampered_access_token_rejected(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    headers = auth_headers(client, admin)
    tampered = headers["Authorization"] + "tampered"
    response = client.get("/api/v1/users", headers={"Authorization": tampered})
    assert response.status_code == 401


def test_user_can_read_own_profile_via_users_me(client, user_factory):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    response = client.get("/api/v1/users/me", headers=auth_headers(client, hod))
    assert response.status_code == 200
    assert response.json()["email"] == hod.email


def test_super_admin_cannot_deactivate_protected_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    protected = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    protected.deactivation_protected = True

    response = client.patch(
        f"/api/v1/users/{protected.id}",
        headers=auth_headers(client, admin),
        json={"is_active": False},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "This account is protected from deactivation."

    get_response = client.get(f"/api/v1/users/{protected.id}", headers=auth_headers(client, admin))
    assert get_response.json()["is_active"] is True


def test_super_admin_can_deactivate_normal_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    normal = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")

    response = client.patch(
        f"/api/v1/users/{normal.id}",
        headers=auth_headers(client, admin),
        json={"is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_super_admin_can_edit_other_fields_on_protected_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    protected = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    protected.deactivation_protected = True

    response = client.patch(
        f"/api/v1/users/{protected.id}",
        headers=auth_headers(client, admin),
        json={"full_name": "Updated Name"},
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Updated Name"


def test_super_admin_can_reactivate_protected_user(client, user_factory):
    admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    protected = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE", is_active=False)
    protected.deactivation_protected = True

    response = client.patch(
        f"/api/v1/users/{protected.id}",
        headers=auth_headers(client, admin),
        json={"is_active": True},
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is True


# DELETE /users/{id} was previously removed as dead code (a regression test
# here asserted 405). That decision has been deliberately reversed -- a real
# hard-delete with safety checks (blocked by related recruitment/interview/
# audit history, SUPER_ADMIN targets, and deactivation_protected accounts) is
# now reintroduced. See tests/test_delete_user.py for the actual coverage.
