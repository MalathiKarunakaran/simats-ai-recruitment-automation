"""Talent pool normaliser, step 1 of docs/specs/talent-pool-sheet-sync.md.

Pure functions that turn what the recruitment sheet's cells say into the
values `TalentPoolEntry` stores: status, eligibility, department group and
`applied_on`. No database, no I/O -- the sync (step 2) calls these per row.

Two decisions here are easy to undo by accident.

**Departments are an exact lookup, not ordered patterns.** Appendix A lists
every spelling the sheet holds, and several sit in a group whose name is not
the first one they contain: "B.ED - CSE" is Education, "EEE / BME" is
Biomedical, "ECE.ME,Ph.D CSE" is CSE. Substring rules checked in table order
would put all three in the wrong group. A lookup reproduces the appendix
exactly, and a spelling nobody has seen comes back as *unmapped* so the sync
can report it, rather than being guessed into a group because it happens to
contain "CSE".

**Each tab has its own date parser.** Slash dates mean opposite things on
the two tabs: Final's are Google Form timestamps (month first), NTS's are
typed by hand (day first). One shared parser would silently swap day and
month on one of them.
"""

import re
from datetime import date

from app.models.enums import TALENT_POOL_NTS_STATUSES, TALENT_POOL_PENDING_STATUS

_PUNCTUATION = re.compile(r"[^\w]+")


def _squash(value: str | None) -> str:
    """Lower-case, trimmed, runs of whitespace collapsed to one space."""
    return " ".join((value or "").split()).lower()


def _key(value: str | None) -> str:
    """The department lookup key: _squash, with punctuation read as a space."""
    return " ".join(_PUNCTUATION.sub(" ", (value or "").lower()).split())


# --- Status ---------------------------------------------------------------

# Teaching column N, spec 4.1. "Eligible" and a blank cell both mean nobody
# has decided yet.
_TEACHING_STATUSES = {
    _squash(s): s
    for s in (
        "Selected",
        "Joined",
        "Waiting List",
        "Rejected",
        "Not Eligible",
        "No Resume Link",
        "Not Valid",
    )
}
_TEACHING_PENDING_SPELLINGS = ("", "eligible")

_NTS_STATUSES = {_squash(s): s for s in TALENT_POOL_NTS_STATUSES}
_NTS_STATUSES["not intrested"] = "Not Interested"

# Column N words that may stand in for a blank Final Status (R) on NTS.
_NTS_REMARK_STATUSES = {
    k: _NTS_STATUSES[k] for k in ("selected", "rejected", "waiting list", "rnr", "not interested", "not intrested")
}
_NTS_NO_OUTCOME = "No outcome"


def teaching_status(status_cell: str | None) -> str:
    """Teaching `sheet_status` from column N.

    A value outside the known set is kept as typed (trimmed), so a new
    status shows up on the dashboard instead of being lost.
    """
    squashed = _squash(status_cell)
    if squashed in _TEACHING_PENDING_SPELLINGS:
        return TALENT_POOL_PENDING_STATUS
    return _TEACHING_STATUSES.get(squashed, " ".join(status_cell.split()))


def nts_status(final_status_cell: str | None, status_cell: str | None) -> tuple[str, bool]:
    """NTS `(sheet_status, status_from_remark)` from column R, else column N.

    N is only trusted when it is exactly a status word; anything else in it
    is a remark, and the row has no outcome yet.
    """
    final = _squash(final_status_cell)
    if final:
        return _NTS_STATUSES.get(final, " ".join(final_status_cell.split())), False
    from_remark = _NTS_REMARK_STATUSES.get(_squash(status_cell))
    if from_remark:
        return from_remark, True
    return _NTS_NO_OUTCOME, False


# --- Eligibility ----------------------------------------------------------

# Teaching column I, spec 4.2. Anything not listed -- blank, "NTS",
# "No Resume" -- is None, which the read side shows as "Not set".
_ELIGIBILITY = {
    "with ph.d": "With Ph.D",
    "thesis submitted": "Thesis / viva stage",
    "synopsis submitted": "Thesis / viva stage",
    "waiting for viva": "Thesis / viva stage",
    "pursuing ph.d": "Pursuing Ph.D",
    "no ph.d": "No Ph.D",
    "not eligible": "Not eligible",
    "no pg": "Not eligible",
    "pursuing pg": "Not eligible",
}


def eligibility(cell: str | None) -> str | None:
    return _ELIGIBILITY.get(_squash(cell))


def eligibility_says_nts(cell: str | None) -> bool:
    """A teaching row whose eligibility cell reads "NTS" -- reported, not moved."""
    return _squash(cell) == "nts"


# --- Department group -----------------------------------------------------

# Appendix A of the spec, generated from it, in its order. `None` is "Not
# set": spellings that are known and deliberately left ungrouped, which is
# different from a spelling nobody has seen (see department_group).
TEACHING_DEPARTMENT_GROUPS: tuple[tuple[str | None, tuple[str, ...]], ...] = (
    ("ECE", (
        "ECE", "ECE TRA",
    )),
    ("Mechanical", (
        "Mechanical", "MECH", "Mech", "ITI MECH", "MECH RESEARCH", "ITI (WELDER)",
        "Marine Engineering",
    )),
    ("CSE", (
        "CSE", "MCA CSE", "IT", "M.SC CSE", "MCA", "MCA, CSE", "B.SC, M.SC, CSE", "M.Sc CS",
        "MCA PHD", "CSE TRA", "MCA,CSE", "CS", "CSE,MS", "M.Sc CSE", "B.CS, M.SC CS",
        "MTech IT", "M.SC IT", "B.SC, M.SC CSE", "B.SC, M.SC CS", "BCA", "B.SC, M.SC IT",
        "MCA , Ph.D CS", "M.SC CS", "B.SC, CSE", "M.SC, CSE", "B.SC CS", "BCA, M.SC IT",
        "MSC CSE", "CSE IT", "ECE.ME,Ph.D CSE", "Computer Science",
    )),
    ("EEE", (
        "EEE", "EEE Research", "B.SC, M.SC, ENEE", "EEE TRA", "B.SC, EEE", "ENEE",
    )),
    ("Maths", (
        "MATHS", "Maths", "Statistics",
    )),
    ("Biotechnology", (
        "B.SC, M.SC BT", "BT", "Biotechnology", "B.SC, M.SC, BT", "B.SC, M.SC,BT",
        "B.Sc, M.Sc BT", "M.SC BT", "B/SC, M.SC BT", "Biotechnlogy", "B.SC , M.SC BT", "BT TRA",
    )),
    ("Civil", (
        "CIVIL", "Civil",
    )),
    ("Chemistry", (
        "CHEMISTRY", "Chemistry", "chemistry", "Chemisty",
    )),
    ("Physics", (
        "PHYSICS", "Physics", "Phyics",
    )),
    ("English", (
        "ENGLISH", "English", "ENGLIGH",
    )),
    ("Architecture", (
        "ARCHITECTURE", "M.Arch", "M.ARCH", "ARCHITECURE", "B.ARCH", "M.Arch Phd",
        "ARCHITECTURE PHD", "B.Arch", "Architecture",
    )),
    ("Soft Skills & Aptitude", (
        "SOFT SKILL", "APTITUDE", "Tech Trainer", "Softskill", "TECH TRAINER",
        "Technical trainer", "SOFTSKILL", "Soft Skill", "Softskill Trainer",
        "Placement Training", "Technical Trainer", "Apptitude", "Aptitude Trainer", "Soft",
    )),
    ("Biomedical", (
        "BME", "Biomedical", "BMA TRA", "BME TRA", "E&I - BME", "Medical Electronics",
        "B.SC,M.SC,BME", "EEE / BME",
    )),
    ("Foreign Languages", (
        "FRENCH", "JAPANESE", "GERMAN", "French", "KOREAN", "Foreign Language", "Chinese",
        "Japanese",
    )),
    ("Design", (
        "FASHION DESIGN", "M.DES", "MDES", "DESIGN", "Fashion Design", "B.DES",
        "INTERIER DESIGN", "Design", "B.DES, MFT", "DESIGNER", "GRAPHIC DESIGN",
        "M.Des - Interior Design", "B. Voc Fashion Technology", "M. Des", "M.Des",
        "Textile Technology", "B.Des", "M.Sc Interior",
    )),
    ("Commerce", (
        "COMMERCE", "B.COM", "Commerce", "M.COM", "B.COM, MBA",
    )),
    ("Bioinformatics", (
        "Bioinformatics", "B.SC, M.SC, BI", "BI", "B.SC, M.SC BI", "BIOINFORMATICS", "M.SC BI",
        "B.Sc, M.Sc, BI", "B.SC, M.SC,BI",
    )),
    ("Fine Arts & Media", (
        "ANIMATION", "VISCOMM", "MFA", "BHARATHAM", "3D ANIMATION", "VISCOM", "FINE ARTS",
        "BFA", "FINE ART", "Viscom", "CONTENT MAKER", "PHOTOGRAPHER", "BFA, MVA", "MUSIC",
        "MEDIA", "Media Arts",
    )),
    ("Management", (
        "MBA", "MANAGEMENT", "BBA, MBA", "BBA", "Management",
    )),
    ("Hotel & Tourism", (
        "Hotel Management", "Tourism Management", "HOTEL", "HOTEL MGT",
        "Diploma Hotel Management", "Hotel MGT", "B.COM, MBA (TOURISM)",
    )),
    ("Life Sciences", (
        "Zoology", "Botany", "Biology", "B.SC, M.SC, BOTANY", "Plant Biology",
        "Fisheries Science", "B.SC ZOOLOGY", "Biological Science", "Marine Science",
        "Fishery Science", "Plant pathology",
    )),
    ("Education", (
        "Education", "B.ED - ZOOLOGY", "B.ED - CSE", "B.ED ZOOLOGY", "B.ED - HISTORY",
        "B.ED - MATHS", "B.ED - TAMIL", "B.ED - ENGLISH", "B.ED PHYSICS", "B.ED CHEMISTRY",
        "B.ED MATHS", "B.ED - CS", "B.ED GEOLOGY", "B.Ed English", "EDUCATION",
        "B.ED SOCIALOGY",
    )),
    ("Biochemistry", (
        "Biochemistry", "BioChemistry",
    )),
    ("Microbiology", (
        "Microbiology",
    )),
    ("Chemical", (
        "CHEMICAL", "Chemical Engineering", "Chemical Eng",
    )),
    ("Physical Education & Yoga", (
        "SSPE", "Yoga", "Physical Education", "YOGA", "PHYSICAL EDUCATION",
    )),
    ("Geology & Environment", (
        "B.SC, M.SC GEOLOGY", "GEOLOGY", "Geology", "Environment Sciences", "Geo Informatics",
    )),
    ("Library", (
        "Librarian", "LIBRARIAN", "BLIS LIBRARIAN",
    )),
    ("Tamil", (
        "TAMIL",
    )),
    ("E&I", (
        "E&I", "ICE", "EIE",
    )),
    ("Food & Nutrition", (
        "Nutrition", "NUTRITION", "Food Technology", "B.SC, M.SC FOOD", "HOME SCIENCE",
        "Food Science",
    )),
    ("Aeronautical", (
        "AERONATICAL", "Aeronatical", "AEROSPACE", "Aeronautical", "Aeronautical Engineering",
    )),
    ("Agriculture", (
        "AGRI", "Agriculture", "HORTICULTURE",
    )),
    ("Allied Health", (
        "Pharmacy", "B.Pharm", "Emergency Care Technology", "Optometry",
        "Anesthesia technology", "Neurology",
    )),
    ("Placement", (
        "PLACEMENT", "PLACEMENT OFFICER",
    )),
    ("Polymer & Plastic Tech", (
        "POLYMER TECH", "PLASTIC TECH", "POLYMER SCIENCE",
    )),
    ("Economics & Social Sciences", (
        "ECONOMICS", "B.A SOCIALOGY", "Economics",
    )),
    ("Nanotechnology", (
        "Nanotech", "Nano technology", "Nanotechnology", "Nano Science",
    )),
    (None, (
        "No Resume", "INVALID", "B.SC, M.SC Ph.D", "With Ph.D", "Admin",
    )),
)


def _build_department_lookup() -> dict[str, str | None]:
    lookup: dict[str, str | None] = {}
    for group, spellings in TEACHING_DEPARTMENT_GROUPS:
        for spelling in spellings:
            key = _key(spelling)
            if key in lookup and lookup[key] != group:
                raise ValueError(f"{spelling!r} maps to both {lookup[key]!r} and {group!r}")
            lookup[key] = group
    return lookup


_DEPARTMENT_LOOKUP = _build_department_lookup()


def department_group(dept_cell: str | None) -> tuple[str | None, bool]:
    """Teaching `(dept_group, unmapped)` for a column G cell.

    `unmapped` is True only for a non-blank spelling Appendix A does not
    list; the sync reports those under `unmapped_departments`. Both a blank
    cell and an unmapped one store a None group ("Not set").
    """
    key = _key(dept_cell)
    if not key:
        return None, False
    if key in _DEPARTMENT_LOOKUP:
        return _DEPARTMENT_LOOKUP[key], False
    return None, True


# --- Dates ----------------------------------------------------------------

_FINAL_DASH = re.compile(r"(\d{1,2})-(\d{1,2})-(\d{4})")
# Google Form timestamp: M/D/YYYY, optionally followed by H:MM:SS.
_FINAL_SLASH = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?")
# NTS: day first whatever the separator, found anywhere in the cell
# ("Mailed on 03-04-25"), two-digit years meaning 20YY.
_NTS_DATE = re.compile(r"(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)")


def _make_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def final_applied_on(cell: str | None) -> date | None:
    """Teaching `applied_on` from column C. `#N/A`, blank or unparsable -> None."""
    text = (cell or "").strip()
    if m := _FINAL_DASH.fullmatch(text):
        day, month, year = map(int, m.groups())
        return _make_date(year, month, day)
    if m := _FINAL_SLASH.fullmatch(text):
        month, day, year = map(int, m.groups())
        return _make_date(year, month, day)
    return None


def _nts_date(cell: str | None) -> date | None:
    for m in _NTS_DATE.finditer(cell or ""):
        day, month, year = (int(g) for g in m.groups())
        if year < 100:
            year += 2000
        if parsed := _make_date(year, month, day):
            return parsed
    return None


def nts_applied_on(call_date_cell: str | None, interview_cell: str | None) -> date | None:
    """NTS `applied_on`: the date in column I, else the one in column K."""
    return _nts_date(call_date_cell) or _nts_date(interview_cell)
