"""Landscape PDF of one selection batch (the list sent to the University).

Built with reportlab's built-in Helvetica like the posters, through the
shared `pdf_layout` helpers (`pdf_text` folds characters the font cannot
draw, `paragraph` wraps and truncates a cell to a fixed number of lines).
"""

import io

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen.canvas import Canvas

from app.models.selection_batch import SelectionBatch
from app.services.pdf_layout import paragraph, pdf_text

NAVY = HexColor("#10294d")
INK = HexColor("#1f2937")
RULE = HexColor("#cbd5e1")
BAND = HexColor("#f1f5f9")

MARGIN = 28
ROW_HEIGHT = 30
HEADER_HEIGHT = 20
FONT = 7.5
LEADING = 9
MAX_LINES = 3

COLUMNS = (  # (title, width in points, attribute)
    ("S.No", 28, None),
    ("Name", 100, "full_name"),
    ("Designation", 100, "designation"),
    ("Department", 100, "department"),
    ("Category", 60, "category"),
    ("Campus", 55, "@campus"),
    ("Qualification", 95, "qualification"),
    ("Experience", 55, "experience"),
    ("Panel remarks", 105, "panel_remarks"),
    ("Proposed salary", 62, "proposed_salary"),
)


def _cell(member, attr: str | None, campus: str, number: int) -> str:
    if attr is None:
        return str(number)
    if attr == "@campus":
        return campus
    return getattr(member, attr) or ""


def render_batch_pdf(batch: SelectionBatch) -> bytes:
    buf = io.BytesIO()
    width, height = landscape(A4)
    canvas = Canvas(buf, pagesize=(width, height))
    canvas.setTitle(pdf_text(f"{batch.batch_no} - Selection list"))
    canvas.setAuthor("SIMATS Recruitment")
    campus = batch.campus.code if batch.campus else ""
    members = list(batch.members)
    pages = [members[i : i + 14] for i in range(0, len(members), 14)] or [[]]

    number = 0
    for page_index, page in enumerate(pages):
        y = height - MARGIN
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(MARGIN, y - 12, pdf_text(f"Selection list {batch.batch_no}"))
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(INK)
        sent = batch.sent_on.strftime("%d-%m-%Y")
        canvas.drawString(MARGIN, y - 28, pdf_text(f"Date: {sent}    Campus: {campus or '-'}    People: {len(members)}"))
        canvas.drawRightString(width - MARGIN, y - 28, f"Page {page_index + 1} of {len(pages)}")
        y -= 40

        x = MARGIN
        canvas.setFillColor(NAVY)
        canvas.rect(MARGIN, y - HEADER_HEIGHT, sum(c[1] for c in COLUMNS), HEADER_HEIGHT, stroke=0, fill=1)
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", FONT)
        for title, col_width, _attr in COLUMNS:
            canvas.drawString(x + 3, y - 13, pdf_text(title))
            x += col_width
        y -= HEADER_HEIGHT

        for row_index, member in enumerate(page):
            number += 1
            if row_index % 2:
                canvas.setFillColor(BAND)
                canvas.rect(MARGIN, y - ROW_HEIGHT, sum(c[1] for c in COLUMNS), ROW_HEIGHT, stroke=0, fill=1)
            x = MARGIN
            for _title, col_width, attr in COLUMNS:
                paragraph(
                    canvas, _cell(member, attr, campus, number), x + 3, y - 10, col_width - 6,
                    size=FONT, leading=LEADING, max_lines=MAX_LINES, color=INK,
                )
                x += col_width
            y -= ROW_HEIGHT
            canvas.setStrokeColor(RULE)
            canvas.line(MARGIN, y, MARGIN + sum(c[1] for c in COLUMNS), y)
        canvas.showPage()
    canvas.save()
    return buf.getvalue()
