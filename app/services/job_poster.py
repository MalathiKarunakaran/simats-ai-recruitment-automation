"""A printable A4 recruitment poster for a published job posting (2026-09-15).

One vector PDF page: the SIMATS seal, the job and its key requirements, the
apply link, and a QR code that opens the posting's public apply page. Built
with reportlab's standard Helvetica, so the server needs no font files --
but those fonts only cover Windows-1252, so every string is folded into it
first (a rupee sign or a Tamil word would otherwise print as a black box).
Generated on demand and never stored, like the QR code.
"""

import io
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen.canvas import Canvas

from app.models.enums import StaffRoleCategoryEnum
from app.services.job_distribution import build_public_apply_url

SEAL_PATH = Path(__file__).resolve().parent.parent / "assets" / "simats-seal.png"

NAVY = HexColor("#14213D")
BLUE = HexColor("#1D4ED8")
BLUE_TINT = HexColor("#DBEAFE")
SKY = HexColor("#93C5FD")
INK = HexColor("#172033")
MUTED = HexColor("#475569")
SOFT = HexColor("#CBD5E1")
LINE = HexColor("#E2E8F0")
PANEL = HexColor("#F1F5F9")

MARGIN = 42
FOOTER_HEIGHT = 118

CATEGORY_LABELS = {
    StaffRoleCategoryEnum.TEACHING: "Teaching",
    StaffRoleCategoryEnum.NON_TEACHING: "Non-Teaching",
    StaffRoleCategoryEnum.HOUSEKEEPING: "Housekeeping",
}


@dataclass(frozen=True)
class PosterContent:
    title: str
    campus_name: str
    department_name: str
    category_label: str
    employment_label: str
    positions_open: int
    qualification: str | None
    experience: str | None
    apply_url: str
    posting_number: str | None
    summary: str | None = None
    skills: tuple[str, ...] = ()
    location: str | None = None
    salary_text: str | None = None
    apply_deadline: date | None = None
    contact_email: str | None = None
    # Poster copy (2026-09-16). Written by the AI from the job description and
    # edited by a person; every one of them is optional and the poster falls
    # back to its original fixed wording when they are unset.
    headline: str | None = None
    pitch: str | None = None
    bullets: tuple[str, ...] = ()


def _pdf_text(value: object) -> str:
    text = str(value).replace("₹", "Rs. ")
    return text.encode("cp1252", errors="replace").decode("cp1252")


def _salary_text(salary_min: float | None, salary_max: float | None) -> str | None:
    def money(value: float) -> str:
        return f"Rs. {value:,.0f}"

    if salary_min is not None and salary_max is not None:
        return f"{money(salary_min)} - {money(salary_max)}"
    if salary_min is not None:
        return f"From {money(salary_min)}"
    if salary_max is not None:
        return f"Up to {money(salary_max)}"
    return None


def poster_content(job_posting) -> PosterContent:
    """The posting's own (edited) content first, the request's for anything
    the posting does not carry."""
    vacancy_request = job_posting.approved_vacancy.vacancy_request
    employment_type = job_posting.employment_type or vacancy_request.employment_type
    return PosterContent(
        title=job_posting.ad_title or vacancy_request.position_title,
        campus_name=job_posting.campus.name,
        department_name=vacancy_request.department.name,
        category_label=CATEGORY_LABELS[job_posting.role_category],
        employment_label=employment_type.value.replace("_", " ").title(),
        positions_open=job_posting.positions_remaining,
        qualification=job_posting.required_qualification or vacancy_request.qualification,
        experience=job_posting.required_experience or vacancy_request.experience_required,
        apply_url=build_public_apply_url(job_posting),
        posting_number=job_posting.posting_number,
        summary=job_posting.summary,
        skills=tuple(job_posting.required_skills or vacancy_request.skills or ()),
        location=job_posting.location_label,
        salary_text=_salary_text(job_posting.salary_min, job_posting.salary_max),
        apply_deadline=job_posting.apply_deadline,
        contact_email=job_posting.contact_email,
        headline=job_posting.poster_headline,
        pitch=job_posting.poster_pitch,
        bullets=tuple(job_posting.poster_bullets or ()),
    )


def render_poster_pdf(content: PosterContent) -> bytes:
    buf = io.BytesIO()
    width, height = A4
    canvas = Canvas(buf, pagesize=A4)
    canvas.setTitle(_pdf_text(f"{content.title} - SIMATS Recruitment"))
    canvas.setAuthor("SIMATS Recruitment")

    _header(canvas, content, width, height)
    chips_bottom = _hiring_block(canvas, content, width, height - 222)
    columns_top = chips_bottom - 30
    qr_card_width = 214
    _qr_card(canvas, content, x=width - MARGIN - qr_card_width, top=columns_top, card_width=qr_card_width)
    _details(canvas, content, x=MARGIN, top=columns_top, column_width=width - 2 * MARGIN - qr_card_width - 28)
    _footer(canvas, content, width)

    canvas.showPage()
    canvas.save()
    return buf.getvalue()


def _header(canvas: Canvas, content: PosterContent, width: float, height: float) -> None:
    band = 170
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - band, width, band, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, height - band - 6, width, 6, stroke=0, fill=1)

    radius = 54
    cx, cy = MARGIN + radius, height - band / 2
    canvas.setFillColor(white)
    canvas.circle(cx, cy, radius, stroke=0, fill=1)
    seal = 2 * radius - 8
    canvas.drawImage(ImageReader(str(SEAL_PATH)), cx - seal / 2, cy - seal / 2, seal, seal, mask="auto")

    text_x = cx + radius + 22
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 32)
    canvas.drawString(text_x, cy + 10, "SIMATS")
    canvas.setFillColor(SOFT)
    canvas.setFont("Helvetica", 11.5)
    canvas.drawString(text_x, cy - 10, "Saveetha Institute of Medical and Technical Sciences")
    canvas.setFillColor(SKY)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(text_x, cy - 28, _pdf_text(content.campus_name))


def _hiring_block(canvas: Canvas, content: PosterContent, width: float, y: float) -> float:
    label = canvas.beginText(MARGIN, y)
    label.setFont("Helvetica-Bold", 13)
    label.setFillColor(BLUE)
    label.setCharSpace(2.5)
    label.textLine(_pdf_text(content.headline.upper() if content.headline else "WE ARE HIRING"))
    # Character spacing is PDF text state and outlives this text object:
    # without the reset every later string is spaced out too, and the chips,
    # the URL and the reference run off the page.
    label.setCharSpace(0)
    canvas.drawText(label)

    y -= 46
    available = width - 2 * MARGIN
    title = _pdf_text(content.title)
    for size in (42, 36, 30, 26):
        lines = simpleSplit(title, "Helvetica-Bold", size, available)
        if len(lines) <= 2:
            break
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", size)
    for line in lines[:3]:
        canvas.drawString(MARGIN, y, line)
        y -= size * 1.12

    # "Electrician" in the "Electrician" department says it once.
    parts = [content.department_name] if content.department_name.strip().lower() != content.title.strip().lower() else []
    parts.append(content.campus_name)
    y -= 4
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 15)
    canvas.drawString(MARGIN, y, _pdf_text(" · ".join(parts)))

    if content.pitch:
        y -= 24
        y = _paragraph(
            canvas, content.pitch, MARGIN, y, width - 2 * MARGIN,
            size=12.5, leading=17, max_lines=2, color=INK,
        ) + 17

    y -= 36
    chips = [content.category_label, content.employment_label]
    if content.positions_open > 0:
        chips.append(f"{content.positions_open} position{'s' if content.positions_open != 1 else ''}")
    x = MARGIN
    for chip in chips:
        text = _pdf_text(chip)
        chip_width = canvas.stringWidth(text, "Helvetica-Bold", 11) + 22
        canvas.setFillColor(BLUE_TINT)
        canvas.roundRect(x, y - 7, chip_width, 26, 13, stroke=0, fill=1)
        canvas.setFillColor(BLUE)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(x + 11, y + 2, text)
        x += chip_width + 8
    return y - 7


def _qr_card(canvas: Canvas, content: PosterContent, *, x: float, top: float, card_width: float) -> None:
    card_height = 300 if content.apply_deadline else 276
    canvas.setFillColor(white)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(1.2)
    canvas.roundRect(x, top - card_height, card_width, card_height, 14, stroke=1, fill=1)

    center = x + card_width / 2
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 16)
    canvas.drawCentredString(center, top - 34, "Scan to apply")

    qr_size = 176
    widget = QrCodeWidget(content.apply_url, barLevel="M")
    x0, y0, x1, y1 = widget.getBounds()
    drawing = Drawing(qr_size, qr_size, transform=[qr_size / (x1 - x0), 0, 0, qr_size / (y1 - y0), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, canvas, center - qr_size / 2, top - 50 - qr_size)

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 10)
    canvas.drawCentredString(center, top - 50 - qr_size - 22, "Opens the job page to apply online")
    if content.apply_deadline:
        canvas.setFillColor(BLUE)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawCentredString(center, top - card_height + 18, f"Apply by {content.apply_deadline.strftime('%d %b %Y')}")


def _heading(canvas: Canvas, text: str, x: float, y: float) -> float:
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 14)
    canvas.drawString(x, y, text)
    canvas.setFillColor(BLUE)
    canvas.rect(x, y - 8, 28, 3, stroke=0, fill=1)
    return y - 28


def _paragraph(
    canvas: Canvas, text: str, x: float, y: float, width: float, *, size: float, leading: float, max_lines: int, color
) -> float:
    lines = simpleSplit(_pdf_text(text), "Helvetica", size, width)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" .,") + "..."
    canvas.setFillColor(color)
    canvas.setFont("Helvetica", size)
    for line in lines:
        canvas.drawString(x, y, line)
        y -= leading
    return y


def _details(canvas: Canvas, content: PosterContent, *, x: float, top: float, column_width: float) -> None:
    floor = FOOTER_HEIGHT + 30
    y = top - 14
    if content.summary:
        y = _heading(canvas, "About the role", x, y)
        y = _paragraph(canvas, content.summary, x, y, column_width, size=11, leading=15, max_lines=5, color=MUTED)
        y -= 14

    if content.bullets:
        y = _heading(canvas, "Highlights", x, y)
        for bullet in content.bullets:
            if y - 30 < floor:
                break
            canvas.setFillColor(BLUE)
            canvas.circle(x + 3, y + 4, 2.4, stroke=0, fill=1)
            y = _paragraph(
                canvas, bullet, x + 14, y, column_width - 14,
                size=11, leading=15, max_lines=2, color=INK,
            )
            y -= 6
        y -= 12

    y = _heading(canvas, "What you need", x, y)
    rows = (
        ("Qualification", content.qualification),
        ("Experience", content.experience),
        ("Skills", ", ".join(content.skills) if content.skills else None),
        ("Location", content.location),
        ("Salary", content.salary_text),
    )
    for label, value in rows:
        if not value:
            continue
        if y - 36 < floor:
            break
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(x, y, label.upper())
        y -= 16
        y = _paragraph(canvas, value, x, y, column_width, size=12.5, leading=16, max_lines=2, color=INK)
        y -= 10


def _footer(canvas: Canvas, content: PosterContent, width: float) -> None:
    canvas.setFillColor(PANEL)
    canvas.rect(0, 0, width, FOOTER_HEIGHT, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, FOOTER_HEIGHT, width, 3, stroke=0, fill=1)

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(MARGIN, FOOTER_HEIGHT - 30, "APPLY ONLINE")

    url = _pdf_text(content.apply_url)
    size = 17.0
    while size > 8 and canvas.stringWidth(url, "Helvetica-Bold", size) > width - 2 * MARGIN:
        size -= 0.5
    url_y = FOOTER_HEIGHT - 54
    canvas.setFillColor(BLUE)
    canvas.setFont("Helvetica-Bold", size)
    canvas.drawString(MARGIN, url_y, url)
    url_width = canvas.stringWidth(url, "Helvetica-Bold", size)
    canvas.linkURL(content.apply_url, (MARGIN, url_y - 4, MARGIN + url_width, url_y + size), relative=0)

    if content.contact_email:
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica", 11)
        canvas.drawString(MARGIN, FOOTER_HEIGHT - 80, _pdf_text(f"Questions: {content.contact_email}"))

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(MARGIN, 24, "SIMATS Recruitment")
    if content.posting_number:
        canvas.drawRightString(width - MARGIN, 24, _pdf_text(f"Ref. {content.posting_number}"))
