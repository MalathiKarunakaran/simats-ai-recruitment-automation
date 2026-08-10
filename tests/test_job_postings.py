from app.models.enums import StaffRoleCategoryEnum

from tests.conftest import auth_headers


def _create_application(client, vacancy, candidate):
    return client.post(
        "/api/v1/applications",
        headers=auth_headers(client, vacancy.recruitment_officer),
        json={"candidate_id": str(candidate.id), "job_posting_id": str(vacancy.job_posting.id)},
    )


def _advance(client, actor, application_id, new_status):
    return client.patch(
        f"/api/v1/applications/{application_id}/status",
        headers=auth_headers(client, actor),
        json={"status": new_status},
    )


def test_list_job_postings_includes_position_and_department(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(slot_count=2)

    response = client.get("/api/v1/job-postings", headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 200
    posting = next(p for p in response.json()["items"] if p["id"] == str(vacancy.job_posting.id))
    assert posting["position_title"] == vacancy.vacancy_request.position_title
    assert posting["department_id"] == str(vacancy.department.id)
    # Before anyone's joined: both slots still needed, none filled yet.
    assert posting["requested_count"] == 2
    assert posting["available_count"] == 0


def test_job_posting_role_category_denormalized_from_vacancy_request(client, published_vacancy_factory):
    # publish() sets JobPosting.role_category = vacancy_request.role_category
    # at creation time (Phase 1 staff-category migrations) -- verify it's
    # both persisted and exposed on the read schema, for a non-default
    # (NON_TEACHING) category so this doesn't just accidentally pass on the
    # published_vacancy_factory's own TEACHING default.
    vacancy = published_vacancy_factory(slot_count=1, role_category=StaffRoleCategoryEnum.NON_TEACHING)

    response = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["role_category"] == "NON_TEACHING"


def test_available_count_only_counts_filled_not_reserved(
    client, published_vacancy_factory, candidate_factory
):
    # available_count (already filled/staffed) only counts FILLED slots -- a
    # candidate merely SELECTED (mid offer/joining, RESERVED) hasn't joined
    # yet, so still counts toward requested_count (still needed), not
    # available_count, until they actually reach JOINED.
    vacancy = published_vacancy_factory(slot_count=3)

    selected_app = _create_application(client, vacancy, candidate_factory()).json()
    joined_app = _create_application(client, vacancy, candidate_factory()).json()

    advance_selected = _advance(client, vacancy.hr_admin, selected_app["id"], "SELECTED")
    assert advance_selected.status_code == 200

    # JOINED requires the application to have already reserved a slot via
    # SELECTED -- _fill_slot_and_maybe_autoclose looks up a RESERVED slot by
    # this application's own id, so it can't be skipped-ahead to directly.
    reserve_first = _advance(client, vacancy.hr_admin, joined_app["id"], "SELECTED")
    assert reserve_first.status_code == 200
    advance_joined = _advance(client, vacancy.hr_admin, joined_app["id"], "JOINED")
    assert advance_joined.status_code == 200

    response = client.get(
        f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    body = response.json()
    # 1 slot still OPEN + 1 RESERVED (selected_app) = 2 still requested/needed;
    # the 3rd (joined_app) is FILLED, so 1 is now available/staffed.
    assert body["requested_count"] == 2
    assert body["available_count"] == 1
