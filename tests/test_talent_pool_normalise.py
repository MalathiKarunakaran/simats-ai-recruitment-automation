"""Talent pool normaliser (docs/specs/talent-pool-sheet-sync.md step 1).

Pure functions, no database. The spellings are the sheet's own, as counted
on 2026-10-28.
"""

import re
from datetime import date
from pathlib import Path

import pytest

from app.services import talent_pool_normalise as n

SPEC = Path(__file__).resolve().parent.parent / "docs" / "specs" / "talent-pool-sheet-sync.md"


# --- Status ---------------------------------------------------------------


@pytest.mark.parametrize(
    "cell, expected",
    [
        ("Selected", "Selected"),
        ("Joined", "Joined"),
        ("waiting  list", "Waiting List"),
        ("REJECTED ", "Rejected"),
        ("Not Eligible", "Not Eligible"),
        ("No Resume Link", "No Resume Link"),
        ("Not Valid", "Not Valid"),
        ("Eligible", "Pending"),
        ("", "Pending"),
        (None, "Pending"),
        ("  Called  twice ", "Called twice"),  # unknown: kept as typed, trimmed
    ],
)
def test_teaching_status(cell, expected):
    assert n.teaching_status(cell) == expected


@pytest.mark.parametrize(
    "final, status, expected",
    [
        ("Rejected", "selected", ("Rejected", False)),  # R wins over N
        ("rnr", None, ("RNR", False)),
        ("Not Intrested", None, ("Not Interested", False)),
        ("Interview Scheduled", None, ("Interview Scheduled", False)),
        ("Shortlisted", None, ("Shortlisted", False)),  # unknown: kept as typed
        ("", "Selected", ("Selected", True)),
        (None, "not intrested", ("Not Interested", True)),
        (" ", "Waiting list", ("Waiting List", True)),
        ("", "Selected for hostel, call back", ("No outcome", False)),  # a remark, not a status
        ("", "On Hold", ("No outcome", False)),  # not one of the N fallback words
        (None, None, ("No outcome", False)),
    ],
)
def test_nts_status(final, status, expected):
    assert n.nts_status(final, status) == expected


# --- Eligibility ----------------------------------------------------------


@pytest.mark.parametrize(
    "cell, expected",
    [
        ("With Ph.D", "With Ph.D"),
        ("With PH.D", "With Ph.D"),
        ("With ph.D", "With Ph.D"),
        ("Thesis Submitted", "Thesis / viva stage"),
        ("Thesis submitted", "Thesis / viva stage"),
        ("Synopsis Submitted", "Thesis / viva stage"),
        ("Waiting for Viva", "Thesis / viva stage"),
        ("Pursuing PH.D", "Pursuing Ph.D"),
        ("No Ph.d", "No Ph.D"),
        ("No PG", "Not eligible"),
        ("Pursuing PG", "Not eligible"),
        ("Not Eligible", "Not eligible"),
        ("", None),
        (None, None),
        ("NTS", None),
        ("No Resume", None),
        ("M.Phil", None),
    ],
)
def test_eligibility(cell, expected):
    assert n.eligibility(cell) == expected


def test_eligibility_nts_is_flagged_for_the_report():
    assert n.eligibility_says_nts(" nts ")
    assert not n.eligibility_says_nts("No Ph.D")


# --- Department group -----------------------------------------------------


def _appendix_a():
    """(group, spelling, count) for every spelling in the spec's Appendix A."""
    text = SPEC.read_text(encoding="utf-8").split("## Appendix A", 1)[1]
    for line in text.splitlines():
        m = re.match(r"\| (.+?) \| (\d+) \| (.+) \|$", line)
        if not m or m.group(2) == "Rows":
            continue
        group, cells = m.group(1), m.group(3)
        for cell in cells.split(" ; "):
            spelling, count = re.match(r"(.+) (\d+)$", cell.strip()).groups()
            yield (None if group == "Not set" else group), spelling, int(count)


def test_every_appendix_a_spelling_maps_to_its_group():
    rows = list(_appendix_a())
    assert sum(count for _, _, count in rows) == 7736  # the Final tab's candidates
    for group, spelling, _ in rows:
        cell = "" if spelling == "blank" else spelling
        assert n.department_group(cell) == (group, False), spelling


def test_appendix_a_has_38_groups_plus_not_set():
    groups = [g for g, _ in n.TEACHING_DEPARTMENT_GROUPS]
    assert len(groups) == 39 and groups[-1] is None


@pytest.mark.parametrize(
    "cell, group",
    [
        # Each contains an earlier group's name; a first-match substring rule
        # would misplace all of them.
        ("B.ED - CSE", "Education"),
        ("EEE / BME", "Biomedical"),
        ("ECE.ME,Ph.D CSE", "CSE"),
        ("E&I - BME", "Biomedical"),
        # Case, spacing and punctuation do not matter.
        ("b.sc,m.sc,  bt", "Biotechnology"),
        (" mca , cse ", "CSE"),
        ("Computer   Science", "CSE"),
    ],
)
def test_department_group_spellings(cell, group):
    assert n.department_group(cell) == (group, False)


def test_unknown_department_is_unmapped_not_guessed():
    assert n.department_group("M.E CSE") == (None, True)
    assert n.department_group("   ") == (None, False)
    assert n.department_group(None) == (None, False)


# --- Dates ----------------------------------------------------------------


@pytest.mark.parametrize(
    "cell, expected",
    [
        ("05-03-2025", date(2025, 3, 5)),  # day first
        ("3/14/2025 10:42:17", date(2025, 3, 14)),  # Google Form: month first
        ("3/5/2025 9:01:00", date(2025, 3, 5)),
        ("12/1/2025", date(2025, 12, 1)),
        ("#N/A", None),
        ("", None),
        (None, None),
        ("14/3/2025 10:42:17", None),  # month 14: not a Form timestamp
        ("31-02-2025", None),
        ("Mailed on 05-03-2025", None),  # Final cells are matched whole
    ],
)
def test_final_applied_on(cell, expected):
    assert n.final_applied_on(cell) == expected


@pytest.mark.parametrize(
    "cell, expected",
    [
        ("05-03-2025", date(2025, 3, 5)),
        ("5-3-2025", date(2025, 3, 5)),
        ("14/03/2025", date(2025, 3, 14)),  # slash is day first on NTS
        ("05/03/2025", date(2025, 3, 5)),
        ("Mailed on 05-03-25", date(2025, 3, 5)),
        ("Mailed on 05-03-2025", date(2025, 3, 5)),
        ("5.3.25", date(2025, 3, 5)),
        ("Need to call", None),
        ("Direct", None),
        ("31-02-2025", None),
        ("", None),
        (None, None),
    ],
)
def test_nts_date_from_call_column(cell, expected):
    assert n.nts_applied_on(cell, None) == expected


def test_nts_falls_back_to_interview_column():
    assert n.nts_applied_on("Need to call", "13-9-25") == date(2025, 9, 13)
    assert n.nts_applied_on("02-09-2025", "13-9-25") == date(2025, 9, 2)
    assert n.nts_applied_on("Direct", "after Pongal") is None


def test_slash_dates_read_opposite_ways_on_the_two_tabs():
    assert n.final_applied_on("3/4/2025") == date(2025, 3, 4)
    assert n.nts_applied_on("3/4/2025", None) == date(2025, 4, 3)
