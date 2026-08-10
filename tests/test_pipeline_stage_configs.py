"""Pipeline stage config -- display-only category-specific pipeline stage
labels (Phase 5). This is a pure config/lookup table: app/services/pipeline.py
and the real Application.status state machine are never touched by anything
in this file or the feature it tests.
"""

from app.models.enums import UserRoleEnum

from tests.conftest import auth_headers

# The three seeded sequences from the original request -- see
# alembic/versions/d1e2f3a4b5c6_phase5_pipeline_stage_configs.py's SEED_ROWS
# (the real migration data). Tests build this same shape through the API
# rather than importing the migration module, matching this repo's existing
# test convention (test_designations.py/test_eligibility_rules.py build
# fixtures via POST, not by reaching into alembic internals).
TEACHING_SEQUENCE = [
    {"sequence_position": 1, "display_label": "Applied", "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {"sequence_position": 2, "display_label": "Screening", "maps_to_status": "SCREENING", "maps_to_interview_type": None},
    {
        "sequence_position": 3,
        "display_label": "Demo class",
        "maps_to_status": "INTERVIEWED",
        "maps_to_interview_type": "TEACHING_DEMO",
    },
    {
        "sequence_position": 4,
        "display_label": "Interview",
        "maps_to_status": "CALLED_FOR_INTERVIEW",
        "maps_to_interview_type": None,
    },
    {"sequence_position": 5, "display_label": "Offer", "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"sequence_position": 6, "display_label": "Joined", "maps_to_status": "JOINED", "maps_to_interview_type": None},
]

NON_TEACHING_SEQUENCE = [
    {"sequence_position": 1, "display_label": "Applied", "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {"sequence_position": 2, "display_label": "Screening", "maps_to_status": "SCREENING", "maps_to_interview_type": None},
    {
        "sequence_position": 3,
        "display_label": "Written test",
        "maps_to_status": "CALLED_FOR_INTERVIEW",
        "maps_to_interview_type": "TECHNICAL",
    },
    {
        "sequence_position": 4,
        "display_label": "Interview",
        "maps_to_status": "INTERVIEWED",
        "maps_to_interview_type": None,
    },
    {"sequence_position": 5, "display_label": "Offer", "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"sequence_position": 6, "display_label": "Joined", "maps_to_status": "JOINED", "maps_to_interview_type": None},
]

HOUSEKEEPING_SEQUENCE = [
    {"sequence_position": 1, "display_label": "Walk-in", "maps_to_status": "APPLIED", "maps_to_interview_type": None},
    {
        "sequence_position": 2,
        "display_label": "Verification",
        "maps_to_status": "SCREENING",
        "maps_to_interview_type": None,
    },
    {"sequence_position": 3, "display_label": "Offer", "maps_to_status": "OFFER_SENT", "maps_to_interview_type": None},
    {"sequence_position": 4, "display_label": "Joined", "maps_to_status": "JOINED", "maps_to_interview_type": None},
]


def _seed_all_sequences(client, admin):
    for role_category, sequence in (
        ("TEACHING", TEACHING_SEQUENCE),
        ("NON_TEACHING", NON_TEACHING_SEQUENCE),
        ("HOUSEKEEPING", HOUSEKEEPING_SEQUENCE),
    ):
        for stage in sequence:
            response = client.post(
                "/api/v1/pipeline-stage-configs",
                headers=auth_headers(client, admin),
                json={"role_category": role_category, **stage},
            )
            assert response.status_code == 201, response.text


def test_super_admin_can_create_and_read_stage_config(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    response = client.post(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, super_admin),
        json={
            "role_category": "TEACHING",
            "sequence_position": 3,
            "display_label": "Demo class",
            "maps_to_status": "INTERVIEWED",
            "maps_to_interview_type": "TEACHING_DEMO",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["role_category"] == "TEACHING"
    assert body["display_label"] == "Demo class"
    assert body["maps_to_status"] == "INTERVIEWED"
    assert body["maps_to_interview_type"] == "TEACHING_DEMO"
    assert body["is_active"] is True


def test_duplicate_sequence_position_for_same_category_is_rejected(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    payload = {
        "role_category": "HOUSEKEEPING",
        "sequence_position": 1,
        "display_label": "Walk-in",
        "maps_to_status": "APPLIED",
    }
    first = client.post(
        "/api/v1/pipeline-stage-configs", headers=auth_headers(client, super_admin), json=payload
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, super_admin),
        json={**payload, "display_label": "Duplicate walk-in"},
    )
    assert second.status_code == 409


def test_non_admin_write_roles_are_forbidden(client, user_factory):
    recruitment_officer = user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SSE")

    response = client.post(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, recruitment_officer),
        json={
            "role_category": "TEACHING",
            "sequence_position": 1,
            "display_label": "Applied",
            "maps_to_status": "APPLIED",
        },
    )
    assert response.status_code == 403


def test_candidate_cannot_read_stage_configs(client, user_factory):
    candidate = user_factory(UserRoleEnum.CANDIDATE)

    response = client.get("/api/v1/pipeline-stage-configs", headers=auth_headers(client, candidate))
    assert response.status_code == 403


def test_super_admin_can_patch_stage_config(client, user_factory):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)

    create_response = client.post(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, super_admin),
        json={
            "role_category": "HOUSEKEEPING",
            "sequence_position": 2,
            "display_label": "Verification",
            "maps_to_status": "SCREENING",
        },
    )
    config_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/pipeline-stage-configs/{config_id}",
        headers=auth_headers(client, super_admin),
        json={"is_active": False, "display_label": "ID Verification"},
    )
    assert patch_response.status_code == 200, patch_response.text
    body = patch_response.json()
    assert body["is_active"] is False
    assert body["display_label"] == "ID Verification"


def test_seeded_teaching_sequence_returns_correctly_ordered(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    _seed_all_sequences(client, hr_admin)

    response = client.get(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, hr_admin),
        params={"role_category": "TEACHING"},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["sequence_position"] for item in items] == [1, 2, 3, 4, 5, 6]
    assert [item["display_label"] for item in items] == [
        "Applied",
        "Screening",
        "Demo class",
        "Interview",
        "Offer",
        "Joined",
    ]
    demo_class = items[2]
    assert demo_class["maps_to_status"] == "INTERVIEWED"
    assert demo_class["maps_to_interview_type"] == "TEACHING_DEMO"
    interview = items[3]
    assert interview["maps_to_status"] == "CALLED_FOR_INTERVIEW"
    assert interview["maps_to_interview_type"] is None


def test_seeded_non_teaching_sequence_returns_correctly_ordered(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    _seed_all_sequences(client, hr_admin)

    response = client.get(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, hr_admin),
        params={"role_category": "NON_TEACHING"},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["sequence_position"] for item in items] == [1, 2, 3, 4, 5, 6]
    assert [item["display_label"] for item in items] == [
        "Applied",
        "Screening",
        "Written test",
        "Interview",
        "Offer",
        "Joined",
    ]
    written_test = items[2]
    assert written_test["maps_to_status"] == "CALLED_FOR_INTERVIEW"
    assert written_test["maps_to_interview_type"] == "TECHNICAL"


def test_seeded_housekeeping_sequence_returns_correctly_ordered(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    _seed_all_sequences(client, hr_admin)

    response = client.get(
        "/api/v1/pipeline-stage-configs",
        headers=auth_headers(client, hr_admin),
        params={"role_category": "HOUSEKEEPING"},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["sequence_position"] for item in items] == [1, 2, 3, 4]
    assert [item["display_label"] for item in items] == ["Walk-in", "Verification", "Offer", "Joined"]
    assert items[0]["maps_to_status"] == "APPLIED"
    assert items[1]["maps_to_status"] == "SCREENING"


def test_no_filter_returns_all_three_sequences(client, user_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    _seed_all_sequences(client, hr_admin)

    response = client.get("/api/v1/pipeline-stage-configs", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == len(TEACHING_SEQUENCE) + len(NON_TEACHING_SEQUENCE) + len(HOUSEKEEPING_SEQUENCE)
