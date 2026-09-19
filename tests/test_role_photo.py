"""The role photograph on a campaign poster (2026-09-18).

The second kind of generated picture, and it obeys the same rule as the
first: generated switched off, printed only once a person has looked at it.
Both go through `job_postings.generate_artwork` / `set_artwork_enabled`, so
these tests are as much about that shared path as about the photo.
"""

from io import BytesIO

from PIL import Image
from pypdf import PdfReader

from app.services import ai_client

from tests.conftest import auth_headers


def _generate(client, vacancy, headers):
    return client.post(f"/api/v1/job-postings/{vacancy.job_posting.id}/generate-role-photo", headers=headers)


def _switch(client, vacancy, headers, enabled: bool):
    return client.patch(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/role-photo", headers=headers, json={"enabled": enabled}
    )


def _campaign_images(pdf: bytes) -> list:
    page = PdfReader(BytesIO(pdf)).pages[0]
    xobjects = page["/Resources"].get("/XObject") or {}
    return [x.get_object() for x in xobjects.values() if x.get_object().get("/Subtype") == "/Image"]


def _campaign(client, vacancy, headers) -> bytes:
    response = client.get(
        f"/api/v1/campaign-posters?posting_ids={vacancy.job_posting.id}", headers=headers
    )
    assert response.status_code == 200, response.text
    return response.content


def test_a_generated_photo_is_stored_switched_off(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    before = len(_campaign_images(_campaign(client, vacancy, headers)))

    response = _generate(client, vacancy, headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_role_photo"] is True
    assert body["role_photo_enabled"] is False
    assert body["role_photo_generated_at"] is not None

    # Generating is not approving: the sheet is unchanged.
    assert len(_campaign_images(_campaign(client, vacancy, headers))) == before


def test_switching_it_on_puts_the_photo_on_the_campaign_sheet(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    before = len(_campaign_images(_campaign(client, vacancy, headers)))

    _generate(client, vacancy, headers)
    switched = _switch(client, vacancy, headers, True)
    assert switched.status_code == 200, switched.text
    assert switched.json()["role_photo_enabled"] is True

    assert len(_campaign_images(_campaign(client, vacancy, headers))) == before + 1

    off_again = _switch(client, vacancy, headers, False)
    assert off_again.status_code == 200
    assert len(_campaign_images(_campaign(client, vacancy, headers))) == before


def test_regenerating_switches_it_off_again(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    _generate(client, vacancy, headers)
    _switch(client, vacancy, headers, True)

    again = _generate(client, vacancy, headers)
    assert again.status_code == 200
    assert again.json()["role_photo_enabled"] is False


def test_switching_on_without_a_photo_is_refused(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _switch(client, vacancy, auth_headers(client, vacancy.hr_admin), True)
    assert response.status_code == 400
    assert "role photo" in response.json()["detail"].lower()


def test_the_preview_serves_the_photo_and_404s_without_one(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"/api/v1/job-postings/{vacancy.job_posting.id}/role-photo"

    assert client.get(url, headers=headers).status_code == 404

    _generate(client, vacancy, headers)
    preview = client.get(url, headers=headers)
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert Image.open(BytesIO(preview.content)).size == (1536, 1024)


def test_the_two_kinds_of_artwork_do_not_overwrite_each_other(client, published_vacancy_factory):
    """Background and role photo are stored under one bucket and differ only
    by filename, so this pins that one does not clobber the other."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    client.post(f"/api/v1/job-postings/{vacancy.job_posting.id}/generate-poster-background", headers=headers)
    body = _generate(client, vacancy, headers).json()

    assert body["has_poster_background"] is True
    assert body["has_role_photo"] is True
    posting = client.get(f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=headers).json()
    assert posting["has_poster_background"] and posting["has_role_photo"]


def test_the_prompt_names_the_role_and_forbids_lettering(published_vacancy_factory):
    """The picture illustrates the work; the advertising is the template's
    job, in real characters. A photo with AI lettering in it would put
    unreviewed words on a printed sheet."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    prompt = ai_client.poster_role_photo_prompt(vacancy.job_posting)

    assert vacancy.vacancy_request.position_title in prompt
    lowered = prompt.lower()
    for forbidden in ("no text", "lettering", "logos"):
        assert forbidden in lowered
    assert "recognisable faces" in lowered
