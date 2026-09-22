"""The A4 campaign poster: several open positions on one sheet (2026-09-18).

This is the poster SIMATS actually prints. `job_poster` advertises ONE
posting on a clean template; a real notice-board sheet advertises a team --
"JOIN OUR MAINTENANCE TEAM" over an electrician, a plumber and an AC
technician -- in the campus's own house style: the logo lockup and
accreditation line, a campus photograph, a coloured ribbon, a pill per role,
panels of eligibility and skills, and an apply strip.

Two rules decide what is drawn here and what is not:

  Every character comes from the postings' own data or the campus identity
  block. Nothing on this sheet is written by an AI at print time, because a
  poster carries an email address and a postal address, and one wrong
  character sends applications nowhere.

  The QR code is a real one (`QrCodeWidget`, the same library behind GET
  /job-postings/{id}/qr-code). An AI-drawn QR is a picture of a QR code: it
  does not scan, and nobody finds out until the applications do not arrive.

Artwork -- the campus photograph, a picture per role -- is the part a
generative model is good at, and is passed in as bytes by the caller (this
module does no IO). Anything missing draws a labelled placeholder instead,
so the sheet is complete and printable before any artwork exists.
"""

import io
from dataclasses import dataclass, field
from datetime import date

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen.canvas import Canvas

from app.services.campus_identity import CampusIdentity
from app.services.pdf_layout import cover_image, paragraph, pdf_text

# The house palette, read off the campus's own 2026 posters.
NAVY = HexColor("#122B6B")
BLUE = HexColor("#1D63C8")
SKY = HexColor("#E8F0FE")
ORANGE = HexColor("#F15A24")
AMBER = HexColor("#F7A928")
GREEN = HexColor("#1E7A46")
INK = HexColor("#16233A")
MUTED = HexColor("#5A6A82")
LINE = HexColor("#D8E1EE")
PAPER = HexColor("#F5F8FD")

MARGIN = 34
# Rotated across the roles, in the order the printed posters use them.
ROLE_COLOURS = (NAVY, ORANGE, GREEN, BLUE)

# --- Vertical budget ---------------------------------------------------------
# An A4 sheet is 841.89pt and every band below is spoken for, so the skills
# columns get what is left rather than whatever happens to remain. The first
# draft gave them 130pt, which truncated every bullet after the first and
# pushed the sidebar out through the footer; these constants exist so that
# cannot happen quietly again.
HEADER_HEIGHT = 246
RIBBON_HEIGHT = 32
ROLE_ART_HEIGHT = 62
# The photographs grow into whatever the two body cards do not need. Real
# postings often carry no `required_skills` at all, and then each skills
# column holds one or two short lines -- which used to print as 20pt of text
# in a 230pt box, with the pictures of the work squeezed above it.
# ROLE_ART_MAX stops a sheet with almost no body text from becoming three
# enormous photographs.
ROLE_ART_MAX = 150
BODY_MIN_HEIGHT = 120
# Breathing room under the last line inside a body card.
PANEL_BOTTOM_PADDING = 14
SIDEBAR_WIDTH = 162
ROLE_LABEL_HEIGHT = 30
APPLY_STRIP_HEIGHT = 76
APPLY_STRIP_Y = 96
FOOTER_HEIGHT = 88
BODY_FLOOR = APPLY_STRIP_Y + APPLY_STRIP_HEIGHT + 14
# Where the campus photograph starts. The hiring headline sits BESIDE it, in
# the column to its left, exactly as the printed posters do -- putting it
# underneath was the first draft's structural mistake and left a third of the
# sheet empty.
PHOTO_LEFT_RATIO = 0.46


@dataclass(frozen=True)
class CampaignRole:
    """One advertised position on the sheet."""

    title: str
    qualification: str | None = None
    experience: str | None = None
    skills: tuple[str, ...] = ()
    employment_label: str | None = None
    positions_open: int = 0
    # A picture of the work, when there is one.
    artwork_png: bytes | None = None


@dataclass(frozen=True)
class CampaignPosterContent:
    identity: CampusIdentity
    # The ribbon: "JOIN OUR MAINTENANCE TEAM".
    ribbon_title: str
    roles: tuple[CampaignRole, ...]
    apply_url: str
    pitch: str | None = None
    hiring_status: str = "Immediate"
    education_lines: tuple[str, ...] = ()
    apply_deadline: date | None = None
    contact_email: str | None = None
    campus_png: bytes | None = None
    logo_png: bytes | None = None
    seal_png: bytes | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)


def render_campaign_poster_pdf(content: CampaignPosterContent) -> bytes:
    buf = io.BytesIO()
    width, height = A4
    canvas = Canvas(buf, pagesize=A4)
    canvas.setTitle(pdf_text(f"{content.ribbon_title} - {content.identity.display_name}"))
    canvas.setAuthor(pdf_text(content.identity.display_name))

    canvas.setFillColor(white)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)

    _header(canvas, content, width, height)
    y = _ribbon(canvas, content, width, height - HEADER_HEIGHT - 6)
    art_height, body_height = _split_space(content, width, y - 16)
    y = _roles_row(canvas, content, width, y - 16, art_height)
    _body(canvas, content, width, y - 12, body_height)
    _apply_strip(canvas, content, width)
    _footer(canvas, content, width)

    canvas.showPage()
    canvas.save()
    return buf.getvalue()


# --- Pieces ------------------------------------------------------------------


def _image_or_placeholder(
    canvas: Canvas, png: bytes | None, x: float, y: float, w: float, h: float, label: str
) -> None:
    """Draws the artwork, or a labelled box where it will go. The placeholder
    is deliberately plain and says what belongs there: a poster printed by
    mistake before the artwork arrives should look unfinished, not wrong."""
    if png:
        # Cropped to fill rather than stretched: a campus photograph squashed
        # into a role card is worse than no photograph.
        reader = cover_image(png, w / h)
        if reader is not None:
            canvas.drawImage(reader, x, y, w, h, mask="auto")
            return
    canvas.setFillColor(SKY)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(1)
    canvas.rect(x, y, w, h, stroke=1, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", min(9, max(6.5, h / 7)))
    canvas.drawCentredString(x + w / 2, y + h / 2 - 3, pdf_text(label))


def _header(canvas: Canvas, content: CampaignPosterContent, width: float, height: float) -> None:
    identity = content.identity
    photo_left = width * PHOTO_LEFT_RATIO
    band_bottom = height - HEADER_HEIGHT

    # The campus photograph, clipped to the concave edge these posters cut it
    # to: it sweeps in at the top, bulges left in the middle, returns at the
    # bottom.
    canvas.saveState()
    path = canvas.beginPath()
    path.moveTo(width, height)
    path.lineTo(width, band_bottom)
    path.lineTo(photo_left + 96, band_bottom)
    path.curveTo(photo_left - 18, band_bottom + 116, photo_left + 4, height - 128, photo_left + 116, height)
    path.close()
    canvas.clipPath(path, stroke=0, fill=0)
    _image_or_placeholder(
        canvas, content.campus_png, photo_left - 30, band_bottom, width - photo_left + 30, HEADER_HEIGHT,
        "campus photograph",
    )
    canvas.restoreState()

    # The amber sweep that edges the photograph.
    canvas.saveState()
    canvas.setStrokeColor(AMBER)
    canvas.setLineWidth(6)
    sweep = canvas.beginPath()
    sweep.moveTo(photo_left + 116 - 7, height)
    sweep.curveTo(
        photo_left + 4 - 7, height - 128,
        photo_left - 18 - 7, band_bottom + 116,
        photo_left + 96 - 7, band_bottom,
    )
    canvas.drawPath(sweep, stroke=1, fill=0)
    canvas.restoreState()

    # --- The left column: logo lockup, then the hiring headline.
    column_width = photo_left - MARGIN - 24
    logo_size = 52
    logo_y = height - MARGIN - logo_size
    _image_or_placeholder(canvas, content.logo_png, MARGIN, logo_y, logo_size, logo_size, "logo")

    text_x = MARGIN + logo_size + 12
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 25)
    canvas.drawString(text_x, logo_y + 27, pdf_text(_lockup_first(identity.display_name)))
    second = _lockup_second(identity.display_name)
    if second:
        canvas.setFillColor(ORANGE)
        canvas.setFont("Helvetica-Bold", 20)
        canvas.drawString(text_x, logo_y + 5, pdf_text(second))
    if identity.motto:
        # Under the logo mark, in its own line -- at the lockup's x it used to
        # run straight into the accreditation line.
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica-Bold", 6.5)
        canvas.drawString(MARGIN, logo_y - 11, pdf_text(identity.motto))

    y = logo_y - 24
    if identity.accreditation:
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 8.5)
        canvas.drawString(text_x, y, pdf_text(identity.accreditation))
        y -= 8
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(1)
        canvas.line(text_x, y, min(text_x + 200, photo_left - 26), y)

    _megaphone(canvas, MARGIN + 14, y - 40, 0.58)
    canvas.setFillColor(BLUE)
    canvas.setFont("Helvetica-BoldOblique", 20)
    canvas.drawString(MARGIN + 84, y - 32, "We are")
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 45)
    canvas.drawString(MARGIN, y - 76, "HIRING!")

    if content.pitch:
        paragraph(
            canvas, content.pitch, MARGIN, y - 98, column_width,
            size=11, leading=14.5, max_lines=3, color=BLUE, font="Helvetica-Bold",
        )

    # The round seal sits over the photograph, top right.
    if content.seal_png:
        seal = 58
        cx, cy = width - MARGIN - seal / 2, height - MARGIN - seal / 2
        canvas.setFillColor(white)
        canvas.circle(cx, cy, seal / 2 + 3, stroke=0, fill=1)
        canvas.drawImage(
            ImageReader(io.BytesIO(content.seal_png)), cx - seal / 2, cy - seal / 2, seal, seal, mask="auto"
        )


def _lockup_first(display_name: str) -> str:
    return display_name.split(" ", 1)[0]


def _lockup_second(display_name: str) -> str | None:
    parts = display_name.split(" ", 1)
    return parts[1] if len(parts) > 1 else None


def _megaphone(canvas: Canvas, x: float, y: float, scale: float = 1.0) -> None:
    """The megaphone every one of these posters opens with. Drawn rather than
    embedded so there is no icon file to ship or lose."""
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(scale, scale)
    canvas.setFillColor(AMBER)
    horn = canvas.beginPath()
    horn.moveTo(10, 10)
    horn.lineTo(44, 26)
    horn.lineTo(44, -26)
    horn.lineTo(10, -10)
    horn.close()
    canvas.drawPath(horn, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.roundRect(-8, -11, 20, 22, 5, stroke=0, fill=1)
    canvas.setFillColor(AMBER)
    canvas.roundRect(44, -8, 7, 16, 3, stroke=0, fill=1)
    canvas.setStrokeColor(AMBER)
    canvas.setLineWidth(2.6)
    for dy, length in ((16, 11), (0, 14), (-16, 11)):
        canvas.line(58, dy, 58 + length, dy)
    canvas.restoreState()


def _ribbon(canvas: Canvas, content: CampaignPosterContent, width: float, top: float) -> float:
    y = top - RIBBON_HEIGHT
    canvas.setFillColor(NAVY)
    canvas.rect(0, y, width * 0.58, RIBBON_HEIGHT, stroke=0, fill=1)
    tail = canvas.beginPath()
    tail.moveTo(width * 0.58, y)
    tail.lineTo(width * 0.58 + 20, y + RIBBON_HEIGHT / 2)
    tail.lineTo(width * 0.58, y + RIBBON_HEIGHT)
    tail.close()
    canvas.drawPath(tail, stroke=0, fill=1)

    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 15.5)
    title = pdf_text(content.ribbon_title.upper())
    limit = width * 0.58 - MARGIN - 14
    while len(title) > 8 and canvas.stringWidth(title, "Helvetica-Bold", 15.5) > limit:
        title = title[:-2]
    canvas.drawString(MARGIN, y + 10, title)

    label = content.identity.location_line
    canvas.setFont("Helvetica-Bold", 9)
    pill_width = canvas.stringWidth(pdf_text(label), "Helvetica-Bold", 9) + 38
    pill_x = width - MARGIN - pill_width
    canvas.setFillColor(white)
    canvas.setStrokeColor(LINE)
    canvas.roundRect(pill_x, y + 3, pill_width, RIBBON_HEIGHT - 6, (RIBBON_HEIGHT - 6) / 2, stroke=1, fill=1)
    canvas.setFillColor(AMBER)
    canvas.circle(pill_x + 14, y + RIBBON_HEIGHT / 2, 5.5, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.drawString(pill_x + 26, y + 11, pdf_text(label))
    return y


def _roles_row(
    canvas: Canvas, content: CampaignPosterContent, width: float, top: float, art_height: float = ROLE_ART_HEIGHT
) -> float:
    roles = content.roles
    if not roles:
        return top
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(MARGIN, top - 10, "OPEN POSITIONS")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(1)
    canvas.line(MARGIN + 104, top - 6, width - MARGIN, top - 6)

    top -= 22
    gap = 11
    available = width - 2 * MARGIN
    card_width = (available - gap * (len(roles) - 1)) / len(roles)
    card_height = art_height + ROLE_LABEL_HEIGHT

    for index, role in enumerate(roles):
        x = MARGIN + index * (card_width + gap)
        colour = ROLE_COLOURS[index % len(ROLE_COLOURS)]
        _image_or_placeholder(
            canvas, role.artwork_png, x, top - art_height, card_width, art_height, f"{role.title} photo"
        )
        canvas.setFillColor(colour)
        canvas.roundRect(x, top - card_height, card_width, ROLE_LABEL_HEIGHT, 6, stroke=0, fill=1)
        canvas.setFillColor(white)
        _centred_lines(
            canvas, role.title.upper(), x + card_width / 2, top - art_height - 13, card_width - 12, size=9.5
        )
        if role.positions_open:
            label = "1 vacancy" if role.positions_open == 1 else f"{role.positions_open} vacancies"
            canvas.setFillColor(white)
            canvas.setFont("Helvetica", 7)
            canvas.drawCentredString(x + card_width / 2, top - card_height + 5, pdf_text(label))
    return top - card_height


def _centred_lines(canvas: Canvas, text: str, cx: float, y: float, width: float, *, size: float) -> None:
    lines = simpleSplit(pdf_text(text), "Helvetica-Bold", size, width)[:2]
    canvas.setFont("Helvetica-Bold", size)
    for line in lines:
        canvas.drawCentredString(cx, y, line)
        y -= size + 1.5


def _panel(canvas: Canvas, x: float, top: float, width: float, height: float, title: str, colour: Color) -> float:
    """A titled card: the tab, then the body outline. Returns the first
    baseline inside it."""
    canvas.setFillColor(white)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(1)
    canvas.roundRect(x, top - height, width, height, 9, stroke=1, fill=1)

    canvas.setFont("Helvetica-Bold", 10.5)
    tab_width = canvas.stringWidth(pdf_text(title), "Helvetica-Bold", 10.5) + 28
    canvas.setFillColor(colour)
    canvas.roundRect(x + 9, top - 19, min(tab_width, width - 18), 21, 7, stroke=0, fill=1)
    canvas.setFillColor(white)
    canvas.drawString(x + 23, top - 13, pdf_text(title))
    return top - 32


def _bullets(
    canvas: Canvas, items, x: float, y: float, width: float, floor: float, *, colour: Color, size: float = 8.4
) -> float:
    for item in items:
        if y - 10 < floor:
            break
        canvas.setFillColor(colour)
        canvas.circle(x + 2.6, y + 3, 2, stroke=0, fill=1)
        y = paragraph(canvas, item, x + 10, y, width - 10, size=size, leading=size + 3, max_lines=3, color=INK) - 3.5
    return y


def _body_widths(width: float) -> tuple[float, float]:
    return width - 2 * MARGIN - SIDEBAR_WIDTH - 12, SIDEBAR_WIDTH


def _body(canvas: Canvas, content: CampaignPosterContent, width: float, top: float, height: float) -> None:
    main_width, sidebar_width = _body_widths(width)
    _skills_panel(canvas, content, MARGIN, top, main_width, height)
    _sidebar(canvas, content, width - MARGIN - sidebar_width, top, sidebar_width, height)


def _body_content_height(content: CampaignPosterContent, width: float) -> float:
    """How tall the two body cards must be to hold what is actually in them,
    measured by drawing them onto a throwaway canvas with room to spare.

    Re-deriving the text metrics here instead would be a second copy of the
    layout, and it would drift from the real one the first time a bullet
    changes size."""
    scratch = Canvas(io.BytesIO(), pagesize=A4)
    top = A4[1]
    roomy = top * 4
    main_width, sidebar_width = _body_widths(width)
    lowest = min(
        _skills_panel(scratch, content, MARGIN, top, main_width, roomy),
        _sidebar(scratch, content, width - MARGIN - sidebar_width, top, sidebar_width, roomy),
    )
    return top - lowest + PANEL_BOTTOM_PADDING


def _split_space(content: CampaignPosterContent, width: float, roles_top: float) -> tuple[float, float]:
    """How the space between the ribbon and the apply strip is divided
    between the photographs of the work and the two body cards.

    The cards take what they need and the photographs take the rest, rather
    than the cards taking everything and the photographs a fixed 62pt."""
    # 22pt for the OPEN POSITIONS heading, 12pt between that row and the body.
    total = roles_top - 22 - ROLE_LABEL_HEIGHT - 12 - BODY_FLOOR
    body_height = max(BODY_MIN_HEIGHT, min(_body_content_height(content, width), total - ROLE_ART_HEIGHT))
    art_height = min(ROLE_ART_MAX, total - body_height)
    # Anything ROLE_ART_MAX refuses goes back to the cards.
    return art_height, total - art_height


def _skills_panel(
    canvas: Canvas, content: CampaignPosterContent, x: float, top: float, width: float, height: float
) -> float:
    """Returns the lowest y it drew to, so the card can be sized to it."""
    y = _panel(canvas, x, top, width, height, "SKILLS REQUIRED", NAVY)
    roles = content.roles[:3]
    if not roles:
        return y
    gap = 9
    column_width = (width - 26 - gap * (len(roles) - 1)) / len(roles)
    floor = top - height + 10
    lowest = y

    for index, role in enumerate(roles):
        colour = ROLE_COLOURS[index % len(ROLE_COLOURS)]
        column_x = x + 13 + index * (column_width + gap)
        column_y = y - 2
        canvas.setFillColor(colour)
        canvas.setFont("Helvetica-Bold", 8.5)
        for line in simpleSplit(pdf_text(role.title.upper()), "Helvetica-Bold", 8.5, column_width)[:2]:
            canvas.drawString(column_x, column_y, line)
            column_y -= 10
        column_y -= 3

        items = list(role.skills)
        if not items:
            # Nothing structured to show: the requirement text beats a blank
            # column.
            items = [text for text in (role.qualification, role.experience) if text]
        lowest = min(lowest, _bullets(canvas, items, column_x, column_y, column_width, floor, colour=colour))

        if index < len(roles) - 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.8)
            divider_x = column_x + column_width + gap / 2
            canvas.line(divider_x, floor, divider_x, y + 2)

    return lowest


def _sidebar(
    canvas: Canvas, content: CampaignPosterContent, x: float, top: float, width: float, height: float
) -> float:
    """Facts, in the order somebody standing at a notice board wants them.
    Returns the lowest y it drew to, so the card can be sized to it.
    Everything is measured against the panel's own floor before it is drawn:
    the first draft let the education bullets run out of the panel and into
    the footer."""
    identity = content.identity
    bottom = top - height
    canvas.setFillColor(PAPER)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(1)
    canvas.roundRect(x, bottom, width, height, 9, stroke=1, fill=1)

    employment = sorted({role.employment_label for role in content.roles if role.employment_label})
    cards: list[tuple[str, tuple[str, ...]]] = [
        ("LOCATION", (identity.display_name, *identity.location_line.split(", "))),
        ("HIRING STATUS", (content.hiring_status,)),
    ]
    if employment:
        cards.append(("JOB TYPES", (", ".join(employment),)))

    deadline_height = 20 if content.apply_deadline else 0
    floor = bottom + 10 + deadline_height
    inner = width - 22
    y = top - 16

    for title, lines in cards:
        if y - 30 < floor:
            break
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(x + 11, y, pdf_text(title))
        y -= 12
        for line in lines:
            if y - 10 < floor:
                break
            y = paragraph(canvas, line, x + 11, y, inner, size=8.3, leading=10.5, max_lines=2, color=MUTED)
        y -= 6
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.7)
        canvas.line(x + 11, y + 3, x + width - 11, y + 3)
        y -= 9

    if content.education_lines and y - 26 > floor:
        canvas.setFillColor(GREEN)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(x + 11, y, "EDUCATION")
        y -= 12
        y = _bullets(canvas, content.education_lines, x + 11, y, inner, floor, colour=GREEN, size=8)

    if content.apply_deadline:
        canvas.setFillColor(ORANGE)
        canvas.roundRect(x + 9, bottom + 8, width - 18, 17, 6, stroke=0, fill=1)
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", 8.5)
        canvas.drawCentredString(
            x + width / 2, bottom + 13.5, pdf_text(f"Apply by {content.apply_deadline:%d %b %Y}")
        )

    # The deadline chip is pinned to the card's floor rather than flowing, so
    # its height is added rather than measured.
    return y - (25 if content.apply_deadline else 0)


def _apply_strip(canvas: Canvas, content: CampaignPosterContent, width: float) -> None:
    y = APPLY_STRIP_Y
    canvas.setFillColor(NAVY)
    canvas.roundRect(MARGIN, y, width - 2 * MARGIN, APPLY_STRIP_HEIGHT, 12, stroke=0, fill=1)

    # Every baseline is placed from the strip's own top so the rule under the
    # title cannot land on the line beneath it.
    text_x = MARGIN + 20
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 20)
    canvas.drawString(text_x, y + 49, "APPLY NOW!")
    canvas.setFillColor(AMBER)
    canvas.rect(text_x, y + 42, 84, 2.5, stroke=0, fill=1)

    if content.contact_email:
        canvas.setFillColor(SKY)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(text_x, y + 29, "Mail your resume to")
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(text_x, y + 16, pdf_text(content.contact_email))
    canvas.setFillColor(SKY)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(text_x, y + 5, pdf_text(content.identity.website))

    # The real, scannable QR -- the one thing on this sheet no model may draw.
    qr_size = 68
    qr_x = width - MARGIN - qr_size - 16
    qr_y = y + (APPLY_STRIP_HEIGHT - qr_size) / 2 + 4
    canvas.setFillColor(white)
    canvas.roundRect(qr_x - 6, qr_y - 6, qr_size + 12, qr_size + 12, 7, stroke=0, fill=1)
    widget = QrCodeWidget(content.apply_url, barLevel="M")
    bounds = widget.getBounds()
    drawing = Drawing(
        qr_size, qr_size,
        transform=[qr_size / (bounds[2] - bounds[0]), 0, 0, qr_size / (bounds[3] - bounds[1]), 0, 0],
    )
    drawing.add(widget)
    renderPDF.draw(drawing, canvas, qr_x, qr_y)

    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawCentredString(qr_x + qr_size / 2, y + 7, "SCAN TO APPLY")


def _footer(canvas: Canvas, content: CampaignPosterContent, width: float) -> None:
    identity = content.identity
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, width, FOOTER_HEIGHT, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.rect(0, FOOTER_HEIGHT, width, 3, stroke=0, fill=1)

    y = FOOTER_HEIGHT - 20
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(MARGIN, y, "POSTAL ADDRESS")
    y -= 12
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    for line in identity.postal_address:
        canvas.drawString(MARGIN, y, pdf_text(line))
        y -= 10

    if identity.tagline:
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-BoldOblique", 14)
        tag_y = FOOTER_HEIGHT - 26
        for line in identity.tagline:
            canvas.drawRightString(width - MARGIN, tag_y, pdf_text(line))
            tag_y -= 17
    canvas.setFillColor(BLUE)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawRightString(width - MARGIN, 14, pdf_text(identity.website))


# --- Building one from real postings -----------------------------------------


def campaign_role(job_posting, artwork_png: bytes | None = None) -> CampaignRole:
    """One posting as it appears on the sheet. Same precedence as the
    single-posting poster: the posting's own edited content first, the vacancy
    request behind it for anything the posting does not carry."""
    vacancy_request = job_posting.approved_vacancy.vacancy_request
    employment_type = job_posting.employment_type or vacancy_request.employment_type
    return CampaignRole(
        title=job_posting.ad_title or vacancy_request.position_title,
        qualification=job_posting.required_qualification or vacancy_request.qualification,
        experience=job_posting.required_experience or vacancy_request.experience_required,
        skills=tuple(job_posting.required_skills or vacancy_request.skills or ()),
        employment_label=employment_type.value.replace("_", " ").title() if employment_type else None,
        positions_open=job_posting.positions_remaining,
        artwork_png=artwork_png,
    )


def campaign_poster_content(
    job_postings,
    *,
    identity: CampusIdentity,
    role_artwork: dict | None = None,
    ribbon_title: str,
    apply_url: str,
    pitch: str | None = None,
    hiring_status: str = "Immediate",
    campus_png: bytes | None = None,
    logo_png: bytes | None = None,
    seal_png: bytes | None = None,
) -> CampaignPosterContent:
    """Assembles the sheet from the postings themselves.

    The education panel is DERIVED rather than typed: the distinct
    qualifications across the advertised roles are what a reader needs, and
    deriving them means the poster cannot claim a qualification no posting
    actually asks for.
    """
    artwork = role_artwork or {}
    roles = tuple(campaign_role(posting, artwork.get(posting.id)) for posting in job_postings)

    education: list[str] = []
    for role in roles:
        if role.qualification and role.qualification not in education:
            education.append(role.qualification)

    deadlines = [posting.apply_deadline for posting in job_postings if posting.apply_deadline]
    contact_emails = [posting.contact_email for posting in job_postings if posting.contact_email]

    return CampaignPosterContent(
        identity=identity,
        ribbon_title=ribbon_title,
        roles=roles,
        apply_url=apply_url,
        pitch=pitch,
        hiring_status=hiring_status,
        education_lines=tuple(education[:3]),
        # The earliest deadline across the sheet: a poster advertising several
        # roles must not imply applications are open after the first closes.
        apply_deadline=min(deadlines) if deadlines else None,
        contact_email=contact_emails[0] if contact_emails else identity.recruitment_email,
        campus_png=campus_png,
        logo_png=logo_png,
        seal_png=seal_png,
    )
