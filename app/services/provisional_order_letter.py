"""The Provisional Appointment Order letter (docs/specs/provisional-order-and-
allotment.md, Q3).

Wording copied from the user's AutoCrat template (31-Oct-2026). Everything
that is the user's -- the wording, the per-campus college names and
principals, the signatory, and which field goes where -- lives in this one
module so it can be edited without touching the order logic.

Field mapping (the template's ‹placeholders›):
- ‹College›      campus code as printed (`printed_code` below)
- ‹Order No›     the per-campus running number, 3 digits
- ‹Month›/‹Year› the order date's month (2 digits) and year
- ‹Date›         the ORDER DATE, DD-MM-YYYY, in all three places the template
                 uses it (header date, "application dated", "from") -- the
                 template uses one date for all three and so do we
- ‹Name›         candidate's full name
- ‹Address›      omitted: the Candidate model holds no postal address
- ‹Grade›        designation (Designation master name, else the vacancy's
                 position title), e.g. "Assistant Professor (SG)"
- ‹Dept›         department name
- ‹Collegename›, ‹Principal›  from CAMPUS_LETTER_DETAILS
"""

import io
from dataclasses import dataclass

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

from app.models.appointment_order import AppointmentOrder
from app.services.pdf_layout import paragraph, pdf_text


@dataclass(frozen=True)
class CampusLetterDetails:
    college_name: str
    principal: str
    printed_code: str


# Keyed by Campus.code, upper-case. A campus missing here cannot be issued an
# order (409) rather than printing a blank principal. SHOTS is listed for
# when that campus exists in the app; SHIFT has no details yet.
CAMPUS_LETTER_DETAILS: dict[str, CampusLetterDetails] = {
    "SSE": CampusLetterDetails("SIMATS Engineering", "Dr. B. Ramesh", "SSE"),
    "SCLAS": CampusLetterDetails("Saveetha College of Liberal Arts & Sciences", "Dr. Gunita Arun Chandhok", "SCLAS"),
    "SCAD": CampusLetterDetails("Saveetha College of Architecture & Design", "Dr. N. Jothilakshmy", "SCAD"),
    "SSPE": CampusLetterDetails("Saveetha School Of Physical Education", "Dr. S. Suganya", "SSPE"),
    "STUDIO": CampusLetterDetails(
        "SIMATS Technological Union of Design Innovation Outreach", "Mr. Maninder Singh", "STUDIO"
    ),
    "SHOTS": CampusLetterDetails("Saveetha Hospitality Institute - Food & Tourism", "Dr. Milton T", "SHoTS"),
    "SPIER": CampusLetterDetails(
        "Saveetha Pedagogical Institute of Education and Research", "Dr. Sudhakar K", "SPIER"
    ),
}

SIGNATORY_NAME = "Dr. K. Malathi"
SIGNATORY_TITLE = "Associate Dean of Recruitment"
PRINCIPAL_TITLE = "Principal"

TITLE = "Provisional Appointment Order"
APPLICATION_LINE = "Your application dated – {date}"
APPOINTMENT_PARAGRAPH = (
    "We are pleased to inform you that you are provisionally appointed as {grade}, "
    "Department of {dept}, {collegename} from {date}."
)
PROBATION_PARAGRAPH = (
    "You will be on probation for a period of three months. During the probationary period, your conduct, "
    "character, attitude, aptitude, temperament, and regularity will be closely monitored, and your "
    "performance will be regularly evaluated. You may be considered for confirmation on satisfactory "
    "completion of the probationary period. You will be paid a monthly salary as applicable to the post "
    "to which you are appointed, as fixed and revised by {collegename} from time to time."
)


def letter_details_for(campus_code: str) -> CampusLetterDetails | None:
    return CAMPUS_LETTER_DETAILS.get((campus_code or "").upper())


def _fields(order: AppointmentOrder) -> dict[str, str]:
    return {
        "date": order.order_date.strftime("%d-%m-%Y"),
        "name": order.candidate_name,
        "grade": order.designation,
        "dept": order.department_name,
        "collegename": order.college_name,
        "principal": order.principal_name,
    }


INK = HexColor("#111827")
MARGIN = 64


def render_letter_pdf(order: AppointmentOrder) -> bytes:
    fields = _fields(order)
    buf = io.BytesIO()
    width, height = A4
    canvas = Canvas(buf, pagesize=A4)
    canvas.setTitle(pdf_text(f"{TITLE} - {order.order_number}"))
    canvas.setAuthor("SIMATS Recruitment")
    text_width = width - 2 * MARGIN

    y = height - 120  # room for the college letterhead on the printed sheet
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica", 11)
    canvas.drawString(MARGIN, y, pdf_text(f"Ref.No. {order.order_number}"))
    canvas.drawRightString(width - MARGIN, y, fields["date"])

    y -= 36
    canvas.drawString(MARGIN, y, "To,")
    y -= 16
    canvas.drawString(MARGIN, y, pdf_text(f"{fields['name']}.,"))
    # ‹Address› would go here; the Candidate model has no address field.

    y -= 40
    canvas.setFont("Helvetica-Bold", 13)
    canvas.drawCentredString(width / 2, y, TITLE)

    y -= 30
    canvas.setFont("Helvetica", 11)
    canvas.drawString(MARGIN, y, pdf_text(APPLICATION_LINE.format(**fields)))

    y -= 28
    y = paragraph(
        canvas, APPOINTMENT_PARAGRAPH.format(**fields), MARGIN, y, text_width,
        size=11, leading=16, max_lines=8, color=INK,
    )
    y -= 12
    y = paragraph(
        canvas, PROBATION_PARAGRAPH.format(**fields), MARGIN, y, text_width,
        size=11, leading=16, max_lines=14, color=INK,
    )

    y -= 90
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(MARGIN, y, pdf_text(SIGNATORY_NAME))
    canvas.drawRightString(width - MARGIN, y, pdf_text(fields["principal"]))
    y -= 15
    canvas.setFont("Helvetica", 11)
    canvas.drawString(MARGIN, y, pdf_text(SIGNATORY_TITLE))
    canvas.drawRightString(width - MARGIN, y, PRINCIPAL_TITLE)

    canvas.showPage()
    canvas.save()
    return buf.getvalue()
