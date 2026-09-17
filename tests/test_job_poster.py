"""The printable A4 job posting poster (2026-09-15)."""

from datetime import date
from io import BytesIO

from pypdf import PdfReader

from app.services.job_poster import PosterContent, render_poster_pdf

from tests.conftest import auth_headers


def _url(vacancy) -> str:
    return f"/api/v1/job-postings/{vacancy.job_posting.id}/poster"


def test_poster_is_one_a4_page_with_the_job_and_its_apply_link(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=3)
    response = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin))

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert f'{vacancy.job_posting.posting_number}-poster.pdf' in response.headers["content-disposition"]

    reader = PdfReader(BytesIO(response.content))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert round(float(page.mediabox.width)) == 595 and round(float(page.mediabox.height)) == 842
    text = page.extract_text()
    assert vacancy.vacancy_request.position_title in text
    assert "Scan to apply" in text
    assert "3 positions" in text
    assert f"/careers/{vacancy.job_posting.public_apply_slug}" in text
    assert "Test qualification" in text


def test_poster_needs_a_published_posting(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    response = client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 409
    assert "published" in response.json()["detail"]


def test_poster_follows_the_distribution_permission_and_campus_scope(client, published_vacancy_factory):
    sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    assert client.get(_url(sse), headers=auth_headers(client, sse.hod)).status_code == 403
    assert client.get(_url(scad), headers=auth_headers(client, sse.recruitment_officer)).status_code == 404


def test_poster_survives_text_the_pdf_font_cannot_draw():
    content = PosterContent(
        title="Lab Assistant – Grade II",
        campus_name="SIMATS Engineering",
        department_name="Biotechnology",
        category_label="Non-Teaching",
        employment_label="Full Time",
        positions_open=1,
        qualification="B.Sc. ₹ தமிழ்",
        experience="2 years",
        apply_url="https://app.example.com/careers/lab-assistant",
        posting_number="JP-2026-000009",
        summary="A long summary. " * 40,
        skills=("Pipetting", "Record keeping"),
        location="Main Block, Floor 2",
        salary_text="Rs. 20,000 - Rs. 30,000",
        apply_deadline=date(2026, 12, 31),
        contact_email="hr@example.com",
    )
    pdf = render_poster_pdf(content)
    text = PdfReader(BytesIO(pdf)).pages[0].extract_text()
    assert "1 position" in text
    assert "Apply by 31 Dec 2026" in text
    assert "Rs." in text


# --- Poster copy (2026-09-16) -----------------------------------------------
# The poster's own marketing wording: written by the AI from the job
# description, edited by a person, and stored so two prints cannot differ.


def test_poster_copy_replaces_the_fixed_wording_and_is_absent_by_default(client, published_vacancy_factory):
    """Without poster copy the poster says WE ARE HIRING, as it always has."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    text = PdfReader(BytesIO(client.get(_url(vacancy), headers=auth_headers(client, vacancy.hr_admin)).content)) \
        .pages[0].extract_text()
    assert "WE ARE HIRING" in text
    assert "Highlights" not in text


def test_generated_poster_copy_reaches_the_printed_poster(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)

    generated = client.post(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/generate-poster-copy", headers=headers
    )
    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["poster_headline"] == "Join Our Faculty"
    assert body["poster_pitch"].startswith("Teach and research")
    assert body["poster_bullets"] == ["Full-time teaching post", "PhD required", "Chennai campus"]
    assert body["poster_copy_generated_at"] is not None

    text = PdfReader(BytesIO(client.get(_url(vacancy), headers=headers).content)).pages[0].extract_text()
    # The headline takes the kicker's place rather than sitting beside it.
    assert "JOIN OUR FACULTY" in text
    assert "WE ARE HIRING" not in text
    assert "Highlights" in text
    assert "PhD required" in text


def test_poster_copy_can_be_edited_by_hand_without_resetting_a_review(client, published_vacancy_factory):
    """The edit that must NOT cost an approval: poster wording is print
    collateral, not the advertisement text the review signed off."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, vacancy.hr_admin)
    status_before = client.get(f"/api/v1/job-postings/{vacancy.job_posting.id}", headers=headers).json()["status"]

    edited = client.patch(
        f"/api/v1/job-postings/{vacancy.job_posting.id}/poster-copy",
        headers=headers,
        json={"poster_headline": "Hand written", "poster_bullets": ["  ", "Kept"]},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["poster_headline"] == "Hand written"
    # Blank bullets are dropped rather than printed as empty rows.
    assert edited.json()["poster_bullets"] == ["Kept"]
    assert edited.json()["status"] == status_before


def test_poster_copy_needs_a_job_description_to_work_from(client, published_vacancy_factory, db_session):
    """There is nothing to write poster wording FROM until the ad has text, so
    this refuses rather than inventing one."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    posting = vacancy.job_posting
    posting.ad_body = None
    posting.summary = None
    db_session.flush()

    response = client.post(
        f"/api/v1/job-postings/{posting.id}/generate-poster-copy",
        headers=auth_headers(client, vacancy.hr_admin),
    )
    assert response.status_code == 400
    assert "job description" in response.json()["detail"].lower()
