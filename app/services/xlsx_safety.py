"""Formula-injection hardening for every workbook this app hands out.

A spreadsheet cell whose text begins with `=` is a formula, and openpyxl
faithfully writes it as one (`data_type 'f'`): a candidate who applies as
`=HYPERLINK("http://evil","Open")` or a QR requester whose justification
starts with `=cmd|...` ends up with executable content in HR's export.
`+`, `-` and `@` are evaluated by Excel when a cell is re-entered or the
sheet is round-tripped through CSV, and `\\t`/`\\r` are field-separator
tricks in the same round trip. Audit finding H3 (2026-09-03).

There is exactly one rule, `safe_cell`, and one sink, `harden_workbook`,
which applies it to every string cell of every sheet immediately before a
workbook is saved. Hardening at the sink rather than at the ~165 individual
`append`/`cell` call sites is what makes the guarantee hold for writers
that do not exist yet. Non-string values (numbers, dates, None) are never
touched, so numeric columns stay numeric.

The escape is the OWASP one: a leading apostrophe. Excel, LibreOffice and
Google Sheets all treat `'=1+1` as the literal text `'=1+1`; nothing
evaluates it. openpyxl also re-types the cell as a string the moment the
value no longer starts with `=`.
"""

from typing import Any

from openpyxl import Workbook

# The first character alone decides. Leading whitespace is deliberately NOT
# stripped first: " =1+1" is already text to every spreadsheet.
DANGEROUS_PREFIXES: tuple[str, ...] = ("=", "+", "-", "@", "\t", "\r")

ESCAPE = "'"


def safe_cell(value: Any) -> Any:
    """`value`, made safe to write into a spreadsheet cell.

    Strings beginning with a formula/separator trigger get a leading
    apostrophe; everything else -- other strings, numbers, dates, None --
    is returned unchanged.
    """
    if isinstance(value, str) and value.startswith(DANGEROUS_PREFIXES):
        return ESCAPE + value
    return value


def harden_workbook(workbook: Workbook) -> Workbook:
    """Apply `safe_cell` to every string cell of every sheet, in place.

    Call this right before `workbook.save(...)`, after the last cell has been
    written. Returns the workbook so it can be chained.
    """
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows():
            for cell in row:
                value = cell.value
                if isinstance(value, str):
                    safe = safe_cell(value)
                    if safe is not value:
                        cell.value = safe
    return workbook
