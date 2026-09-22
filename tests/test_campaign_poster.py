"""The multi-role campaign poster (2026-09-18).

The sheet that actually goes on a notice board: several open positions, the
campus's own identity block, and a QR code that has to work.
"""

from io import BytesIO

from pypdf import PdfReader

from app.api.v1.routers.campaign_posters import apply_url_for
from app.services import campaign_poster
from app.services.campus_identity import SSE

from tests.conftest import auth_headers


def _url(ids, **params) -> str:
    query = "&".join([f"posting_ids={','.join(str(i) for i in ids)}"] + [f"{k}={v}" for k, v in params.items()])
    return f"/api/v1/campaign-posters?{query}"


def _text(pdf: bytes) -> str:
    return PdfReader(BytesIO(pdf)).pages[0].extract_text()


def test_one_sheet_carries_every_role_and_the_campus_identity(client, published_vacancy_factory):
    first = published_vacancy_factory(campus_code="SSE", slot_count=2)
    second = published_vacancy_factory(campus_code="SSE", slot_count=1)
    headers = auth_headers(client, first.hr_admin)

    response = client.get(
        _url([first.job_posting.id, second.job_posting.id], title="Join%20our%20maintenance%20team"),
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert "sse-campaign-poster.pdf" in response.headers["content-disposition"]

    reader = PdfReader(BytesIO(response.content))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert round(float(page.mediabox.width)) == 595 and round(float(page.mediabox.height)) == 842

    text = page.extract_text()
    assert "JOIN OUR MAINTENANCE TEAM" in text
    for vacancy in (first, second):
        assert vacancy.vacancy_request.position_title.upper() in text.upper()
    # The campus identity block, which no posting supplies.
    assert SSE.recruitment_email in text
    assert "SIMATS" in text
    assert "POSTAL ADDRESS" in text


def _embedded_images(pdf: bytes) -> list:
    page = PdfReader(BytesIO(pdf)).pages[0]
    xobjects = page["/Resources"].get("/XObject") or {}
    return [x for x in xobjects.values() if x.get_object().get("/Subtype") == "/Image"]


def test_the_qr_code_is_drawn_rather_than_pictured():
    """The reason this poster is a template and not a generated image: a QR
    code that does not scan fails silently, and nobody finds out until the
    applications do not arrive.

    Rendered with NO artwork, so every bitmap on the page would have to be the
    QR. There are none: it is vector barcode geometry.
    """
    content = campaign_poster.CampaignPosterContent(
        identity=SSE,
        ribbon_title="Join our maintenance team",
        roles=(campaign_poster.CampaignRole(title="Plumber"),),
        apply_url="https://example.invalid/careers/plumber",
    )
    assert _embedded_images(campaign_poster.render_campaign_poster_pdf(content)) == []


def test_supplied_artwork_reaches_the_sheet(client, published_vacancy_factory):
    """The campus logo, seal and photograph are files on disk; when they are
    there they are drawn, and each one is a bitmap on the page."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(_url([vacancy.job_posting.id]), headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 200, response.text

    supplied = [name for name in ("logo.png", "seal.png", "campus.jpg") if SSE.asset_path(name)]
    assert len(_embedded_images(response.content)) == len(supplied)


def test_where_the_qr_code_sends_a_reader(client, published_vacancy_factory):
    """One role: that role's own page. Several: the careers list, because a
    sheet offering three jobs whose QR opens only the first is quietly
    wrong."""
    first = published_vacancy_factory(campus_code="SSE", slot_count=1)
    second = published_vacancy_factory(campus_code="SSE", slot_count=1)

    alone = apply_url_for([first.job_posting])
    assert alone.endswith(f"/careers/{first.job_posting.public_apply_slug}")

    together = apply_url_for([first.job_posting, second.job_posting])
    assert together.endswith("/careers")
    assert first.job_posting.public_apply_slug not in together

    # And the sheet itself still prints for both.
    response = client.get(
        _url([first.job_posting.id, second.job_posting.id]), headers=auth_headers(client, first.hr_admin)
    )
    assert response.status_code == 200


def test_a_poster_refuses_to_mix_two_campuses(client, published_vacancy_factory):
    """One sheet carries one campus's logo, address and QR: mixing them would
    tell half the readers to apply to the wrong place."""
    sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    response = client.get(
        _url([sse.job_posting.id, scad.job_posting.id]), headers=auth_headers(client, sse.hr_admin)
    )
    assert response.status_code == 400
    assert "same campus" in response.json()["detail"]


def test_an_unpublished_posting_is_refused(client, published_vacancy_factory):
    live = published_vacancy_factory(campus_code="SSE", slot_count=1)
    draft = published_vacancy_factory(campus_code="SSE", slot_count=1, live=False)
    response = client.get(
        _url([live.job_posting.id, draft.job_posting.id]), headers=auth_headers(client, live.hr_admin)
    )
    assert response.status_code == 409
    assert "not published" in response.json()["detail"]


def test_the_sheet_is_capped_at_six_positions(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    ids = [vacancy.job_posting.id] + [f"0000000{n}-0000-0000-0000-000000000000" for n in range(1, 7)]
    response = client.get(_url(ids), headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 400
    assert "six positions" in response.json()["detail"]


def test_no_postings_named_is_refused(client, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(
        "/api/v1/campaign-posters?posting_ids=%20", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


def test_missing_artwork_prints_a_labelled_placeholder_rather_than_failing():
    """The campus logo and photograph are not in the repo yet. The sheet still
    has to print, and has to look unfinished rather than wrong."""
    content = campaign_poster.CampaignPosterContent(
        identity=SSE,
        ribbon_title="Join our maintenance team",
        roles=(campaign_poster.CampaignRole(title="Plumber", skills=("Pipework",)),),
        apply_url="https://example.invalid/careers",
    )
    text = _text(campaign_poster.render_campaign_poster_pdf(content))
    assert "campus photograph" in text
    assert "logo" in text


def test_the_earliest_deadline_across_the_sheet_is_the_one_printed(client, published_vacancy_factory, db_session):
    """A sheet advertising several roles must not imply applications are open
    after the first of them closes."""
    from datetime import date

    first = published_vacancy_factory(campus_code="SSE", slot_count=1)
    second = published_vacancy_factory(campus_code="SSE", slot_count=1)
    first.job_posting.apply_deadline = date(2026, 11, 30)
    second.job_posting.apply_deadline = date(2026, 12, 31)
    db_session.flush()

    response = client.get(
        _url([first.job_posting.id, second.job_posting.id]), headers=auth_headers(client, first.hr_admin)
    )
    assert response.status_code == 200
    text = _text(response.content)
    assert "30 Nov 2026" in text
    assert "31 Dec 2026" not in text


def _split_for(roles, *, education=()) -> tuple[float, float]:
    """The photo/body division the renderer would use for these roles."""
    from reportlab.lib.pagesizes import A4

    content = campaign_poster.CampaignPosterContent(
        identity=SSE,
        ribbon_title="Join our maintenance team",
        roles=roles,
        apply_url="https://example.com/careers",
        education_lines=education,
    )
    width, height = A4
    ribbon_y = height - campaign_poster.HEADER_HEIGHT - 6 - 32
    return campaign_poster._split_space(content, width, ribbon_y - 16)


def test_the_photographs_take_the_space_the_body_cards_do_not_need():
    """Found on the first real prod sheet: all three live postings had no
    `required_skills`, so each skills column held two short lines inside a
    230pt card while the pictures of the work were squeezed into 62pt.

    The cards are sized to what they hold and the photographs take the rest.
    """
    bare = (
        campaign_poster.CampaignRole(title="Electrician", qualification="ITI Diploma", experience="1+ years"),
        campaign_poster.CampaignRole(title="AC Helper", qualification="ITI Diploma", experience="1+ years"),
    )
    art, body = _split_for(bare, education=("ITI Diploma",))
    assert art > campaign_poster.ROLE_ART_HEIGHT
    assert art <= campaign_poster.ROLE_ART_MAX

    # The same roles with more to say in the body: the cards take it back and
    # the photographs give it up. Only the sidebar changes, because the
    # sidebar is the taller of the two cards on a sheet like this one -- the
    # panels are sized together so they stay aligned.
    art_full, body_full = _split_for(
        bare, education=tuple(f"Diploma in discipline number {n}" for n in range(6))
    )
    assert body_full > body
    assert art_full < art
    # Nothing is invented or lost: the two shares still fill the same band.
    assert round(art + body, 6) == round(art_full + body_full, 6)


def test_a_body_card_is_never_shorter_than_what_it_holds():
    """The failure this guards is silent: a card sized below its content
    clips bullets against its own floor rather than erroring."""
    crowded = tuple(
        campaign_poster.CampaignRole(
            title=f"Role {n}",
            skills=tuple(f"A requirement written out at some length, number {i}" for i in range(4)),
        )
        for n in range(3)
    )
    art, body = _split_for(crowded, education=("ITI Diploma", "Diploma in Electrical Engineering"))
    content = campaign_poster.CampaignPosterContent(
        identity=SSE,
        ribbon_title="Join our maintenance team",
        roles=crowded,
        apply_url="https://example.com/careers",
        education_lines=("ITI Diploma", "Diploma in Electrical Engineering"),
    )
    from reportlab.lib.pagesizes import A4

    assert body >= min(
        campaign_poster._body_content_height(content, A4[0]),
        art + body - campaign_poster.ROLE_ART_HEIGHT,
    )
    assert art >= campaign_poster.ROLE_ART_HEIGHT


def test_an_untitled_sheet_puts_the_campus_in_the_ribbon_rather_than_repeating_the_headline(
    client, published_vacancy_factory
):
    """The screen sends no `title` unless somebody types one, so this is the
    default sheet, not an edge case. The header already prints "We are
    HIRING!" in 40pt; the old default printed it again in the ribbon."""
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    response = client.get(
        _url([vacancy.job_posting.id]), headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200, response.text

    text = _text(response.content)
    assert SSE.display_name.upper() in text.upper()
    # The fixed headline is still there, exactly once more than the ribbon.
    assert text.upper().count("WE ARE") == 1
