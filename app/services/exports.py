"""File-generation helpers for Module 12's Excel/PPT exports.

Pure functions: given already-computed report/summary data, return raw
bytes. No DB access here -- app/services/reporting.py owns all querying.

PPT branding: the actual current SIMATS AD-meeting PPT template, logo, and
exact brand hex codes weren't available to reconstruct exactly, so
_NAVY/_GOLD below are documented placeholders reproducing the described
structure (navy/gold, single slide, campus x role-category breakdown) --
swap in the real brand assets when available.
"""

import io
from datetime import datetime

from openpyxl import Workbook
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

# Placeholder brand colors -- TODO: replace with the real SIMATS navy/gold
# hex codes and logo once the actual AD-meeting PPT template is available.
_NAVY = RGBColor(0x0B, 0x1F, 0x3A)
_GOLD = RGBColor(0xC9, 0xA2, 0x27)
_WHITE = RGBColor(0xFF, 0xFF, 0xFF)

_REPORT_FIELDS: dict[str, list[str]] = {
    "recruitment-funnel": ["campus_code", "status", "count"],
    "campus-role-hiring": ["campus_code", "role_category", "hired_count"],
    "interviews": ["campus_code", "status", "interview_type", "count"],
    "offers": ["campus_code", "status", "count"],
    "joining": ["campus_code", "onboarding_status", "count"],
    "vacancies": ["campus_code", "role_category", "status", "count"],
    "time-to-hire": ["campus_code", "role_category", "avg_days", "hired_count"],
}


def build_report_excel(report_type: str, rows: list[dict], generated_at: datetime, scope_note: str) -> bytes:
    fields = _REPORT_FIELDS[report_type]

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = report_type[:31]

    sheet.append([f"Generated: {generated_at.isoformat()}"])
    sheet.append([f"Scope: {scope_note}"])
    sheet.append([])
    sheet.append(fields)
    for row in rows:
        sheet.append([row.get(field) for field in fields])

    buf = io.BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def build_ad_briefing_pptx(summary: dict) -> bytes:
    presentation = Presentation()
    presentation.slide_width = Inches(13.33)
    presentation.slide_height = Inches(7.5)
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])  # blank layout

    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, presentation.slide_width, presentation.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = _NAVY
    background.line.fill.background()
    background.shadow.inherit = False

    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(12.3), Inches(0.9))
    title_frame = title_box.text_frame
    title_frame.text = "SIMATS Recruitment — AD Briefing"
    title_run = title_frame.paragraphs[0].runs[0]
    title_run.font.size = Pt(32)
    title_run.font.bold = True
    title_run.font.color.rgb = _GOLD

    generated_at = summary["generated_at"]
    subtitle_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.1), Inches(12.3), Inches(0.4))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = f"{summary['scope_note']} — generated {generated_at.isoformat()}"
    subtitle_run = subtitle_frame.paragraphs[0].runs[0]
    subtitle_run.font.size = Pt(14)
    subtitle_run.font.color.rgb = _WHITE

    kpi = summary["kpi_headline"]
    period_label = summary["period_label"]
    kpi_text = (
        f"Applications: {kpi['total_applications']}  |  Open positions: {kpi['open_positions']}  |  "
        f"Interviews ({period_label}): {kpi['interviews_today']}  |  Joinings ({period_label}): {kpi['joinings_today']}  |  "
        f"Offers pending: {kpi['offers_pending']}  |  Closure rate: {kpi['vacancy_closure_rate_pct']}%"
    )
    kpi_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.7), Inches(12.3), Inches(0.6))
    kpi_frame = kpi_box.text_frame
    kpi_frame.word_wrap = True
    kpi_frame.text = kpi_text
    kpi_run = kpi_frame.paragraphs[0].runs[0]
    kpi_run.font.size = Pt(14)
    kpi_run.font.color.rgb = _GOLD

    breakdown = summary["campus_role_breakdown"]
    table_rows = max(len(breakdown) + 1, 2)
    table_shape = slide.shapes.add_table(
        table_rows, 5, Inches(0.5), Inches(2.5), Inches(12.3), Inches(4.5)
    )
    table = table_shape.table
    headers = ["Campus", "Role Category", "Open", "In Pipeline", "Hired"]
    for col_index, header in enumerate(headers):
        cell = table.cell(0, col_index)
        cell.text = header
        cell.text_frame.paragraphs[0].runs[0].font.bold = True

    for row_index, entry in enumerate(breakdown, start=1):
        values = [
            entry["campus_code"],
            entry["role_category"],
            str(entry["open_positions"]),
            str(entry["in_pipeline"]),
            str(entry["hired"]),
        ]
        for col_index, value in enumerate(values):
            table.cell(row_index, col_index).text = value

    buf = io.BytesIO()
    presentation.save(buf)
    return buf.getvalue()
