"""The AI-generated image behind the poster's header band (2026-09-17).

The property every test here circles is the switch: an image is generated,
stored and PREVIEWABLE, and none of that puts it on a printed poster until a
person turns it on.
"""

import base64
from io import BytesIO

from PIL import Image
from pypdf import PdfReader

from app.services import job_poster

from tests.conftest import FakeOpenAIImagesResponse, auth_headers, fake_png_bytes


def _embedded_images(pdf: bytes) -> list:
    """Every image on the poster page. A plain poster carries exactly one --
    the SIMATS seal -- so a background is the difference between one and two.
    File size is NOT the test: a flat test image compresses to under a
    kilobyte against a 400 KB poster."""
    page = PdfReader(BytesIO(pdf)).pages[0]
    xobjects = page["/Resources"].get("/XObject") or {}
    return [x.get_object() for x in xobjects.values() if x.get_object().get("/Subtype") == "/Image"]


def _poster(client, vacancy, headers) -> bytes:
    response = client.get(f"/api/v1/job-postings/{vacancy.job_posting.id}/poster", headers=headers)
    assert response.status_code == 200, response.text
    return response.content


def _generate(client, vacancy, headers):
    return client.post(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/generate-poster-background", headers=headers
    )


def _switch(client, vacancy, headers, enabled: bool):
    return client.patch(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/poster-background",
        headers=headers,
        json={"enabled": enabled},
    )


def test_a_generated_background_is_stored_switched_off(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    plain_poster = _poster(client, vacancy, headers)

    response = _generate(client, vacancy, headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_poster_background"] is True
    assert body["poster_background_generated_at"] is not None
    # The whole point: generating is not approving.
    assert body["poster_background_enabled"] is False
    # And the printed poster carries exactly what it carried before: the seal.
    assert len(_embedded_images(_poster(client, vacancy, headers))) == len(_embedded_images(plain_poster)) == 1


def test_switching_it_on_puts_the_image_on_the_printed_poster(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    plain_poster = _poster(client, vacancy, headers)
    _generate(client, vacancy, headers)

    switched = _switch(client, vacancy, headers, True)
    assert switched.status_code == 200, switched.text
    assert switched.json()["poster_background_enabled"] is True

    images = _embedded_images(_poster(client, vacancy, headers))
    assert len(images) == 2, "the seal and the background"
    assert max(int(image["/Width"]) for image in images) == 1536

    off_again = _switch(client, vacancy, headers, False)
    assert off_again.status_code == 200
    assert len(_embedded_images(_poster(client, vacancy, headers))) == 1


def test_switching_on_without_an_image_is_refused(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = _switch(client, vacancy, auth_headers(client, vacancy.hr_admin), True)
    assert response.status_code == 400
    assert "generate" in response.json()["detail"].lower()


def test_regenerating_switches_it_off_again(client, published_vacancy_factory):
    """The image somebody approved is not the image now stored, so the
    approval does not survive a regenerate."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    _generate(client, vacancy, headers)
    _switch(client, vacancy, headers, True)

    again = _generate(client, vacancy, headers)
    assert again.status_code == 200, again.text
    assert again.json()["poster_background_enabled"] is False


def test_the_preview_serves_the_image_and_404s_without_one(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"/api/v1/job-postings/{vacancy.job_posting.id}/poster-background"

    missing = client.get(url, headers=headers)
    assert missing.status_code == 404

    _generate(client, vacancy, headers)
    preview = client.get(url, headers=headers)
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert Image.open(BytesIO(preview.content)).size == (1536, 1024)


def test_generating_never_moves_the_posting_through_its_review(client, published_vacancy_factory):
    """Same rule as the poster copy: print collateral must not cost an
    approval."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    before = client.get(f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=headers).json()["status"]

    assert _generate(client, vacancy, headers).json()["status"] == before
    assert _switch(client, vacancy, headers, True).json()["status"] == before


def test_an_unreadable_image_costs_the_picture_not_the_poster(client, published_vacancy_factory, fake_openai_client):
    """Storage handed back something that is not an image. The recruiter still
    gets a poster -- the plain navy band, as before backgrounds existed."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    plain_poster = _poster(client, vacancy, headers)

    fake_openai_client.image_provider = lambda kwargs: FakeOpenAIImagesResponse(
        base64.b64encode(b"this is not a PNG").decode()
    )
    _generate(client, vacancy, headers)
    _switch(client, vacancy, headers, True)

    assert len(_embedded_images(_poster(client, vacancy, headers))) == len(_embedded_images(plain_poster)) == 1


def test_an_empty_answer_from_the_image_model_is_a_502(client, published_vacancy_factory, fake_openai_client):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    fake_openai_client.image_provider = lambda kwargs: FakeOpenAIImagesResponse(None)
    response = _generate(client, vacancy, headers)
    assert response.status_code == 502
    assert "image" in response.json()["detail"].lower()
    # Nothing was written: a failed generation leaves the posting alone.
    posting = client.get(f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=headers).json()
    assert posting["has_poster_background"] is False


def test_the_band_crop_fills_the_header_rather_than_squashing_it():
    """A 3:2 image into a ~3.5:1 band: the renderer crops, it does not
    scale, so nothing on the poster is stretched."""
    reader = job_poster._band_image(fake_png_bytes(1536, 1024), 3.5)
    assert reader is not None
    width, height = reader.getSize()
    assert width == 1536, "the full width is kept; it is the height that is cropped"
    assert abs(width / height - 3.5) < 0.01


def test_the_status_endpoint_answers_without_calling_the_ai(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(
        "/api/v1/job-postings/poster-background/status", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    # OpenAI whatever AI_PROVIDER says -- images have no Ollama equivalent.
    assert response.json()["provider"] == "openai"
