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
