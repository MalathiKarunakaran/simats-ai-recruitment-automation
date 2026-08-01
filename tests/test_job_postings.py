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
    assert posting["required_count"] == 2
    assert posting["available_count"] == 2


def test_available_count_excludes_filled_but_includes_reserved(
    client, published_vacancy_factory, candidate_factory
):
    # Available = OPEN + RESERVED, only FILLED (an actual join) reduces it --
    # a candidate merely SELECTED (mid offer/joining) hasn't locked the seat.
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
    assert body["required_count"] == 3
    # 1 slot still OPEN + 1 RESERVED (selected_app) = 2 available; the 3rd is FILLED.
    assert body["available_count"] == 2
