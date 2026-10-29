"""Talent pool sync, step 2 of docs/specs/talent-pool-sheet-sync.md.

The only writer of `talent_pool_entries`. n8n posts one full snapshot of one
tab; this works out what was inserted, changed, unchanged or removed, and
applies it in the caller's transaction, so a failed sync changes nothing.

Three rules here are easy to break by accident.

**Columns are found by header name, never by letter.** The sheet is edited
by hand and a column can be inserted at any time; a letter-based mapping
would silently read the wrong column from then on. A header this module
expects but does not find is reported in `missing_headers`, and a missing
Name header refuses the whole snapshot (422), since without it every row
would be skipped and every existing row deactivated.

**A row's identity is the person, not the row number** (`row_key`): email,
else name + phone digits, plus which repeat of that person this is in sheet
order. Re-sorting the sheet or inserting a row therefore updates nothing.
Duplicates are kept as their own rows, so the page counts match the sheet
row for row, and reported.

**Only rows the sync wrote are ever changed.** A row with no `row_key` was
entered by hand; it is never updated or deactivated here. A keyed row that
disappears from the sheet is deactivated, never deleted, and comes back if
the person reappears.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import TALENT_POOL_SYNCED_ACTION, TalentPoolSourceTabEnum
from app.models.talent_pool_entry import TalentPoolEntry
from app.schemas.talent_pool_sync import (
    SyncDuplicate,
    SyncRowNote,
    TalentPoolSyncRequest,
    TalentPoolSyncResult,
)
from app.services import talent_pool_normalise as normalise
from app.services.audit import log_event

REPORT_CAP = 200

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DIGITS = re.compile(r"\D+")


def _header_key(header: str | None) -> str:
    return _NON_ALNUM.sub(" ", (header or "").lower()).strip()


# Field -> the header spellings it may appear under (compared by _header_key,
# so case, spaces and punctuation do not matter). The first spelling of each
# is the one the live sheet used on 2026-10-29.
_FINAL_COLUMNS = {
    "name": ("Name",),
    "email": ("Mail ID",),
    "phone": ("Phone Number",),
    "source": ("Data",),
    "applied": ("Applied Date",),
    "dept": ("Actual Dept",),
    "resume": ("Google Link",),
    "eligibility": ("PhD / Eligible Status",),
    "status": ("Status",),
    "interview": ("Date of Interview",),
    "remarks": ("General Remark",),
    "called_by": ("Interview Called by",),
}
_NTS_COLUMNS = {
    "name": ("Name",),
    "email": ("Mail ID",),
    "phone": ("Phone No",),
    "applied_post": ("Applied Post",),
    "dept": ("Department",),
    "source": ("Reference",),
    "call_date": ("Call Date/ Mail Sent Date",),
    "interview": ("Interview Schduled Date", "Interview Scheduled Date"),
    "general_remark": ("General Remark",),
    "remarks": ("Remarks",),
    "status": ("Status",),
    "final_status": ("Final Status",),
}

# Column lengths in TalentPoolEntry; a longer cell is cut rather than
# failing the whole tab's transaction.
_LIMITS = {
    "full_name": 255,
    "email": 320,
    "phone": 50,
    "dept_raw": 255,
    "dept_group": 255,
    "applied_post": 255,
    "sheet_status": 64,
    "eligibility": 64,
    "eligibility_raw": 255,
    "interview_on_raw": 100,
    "called_by": 255,
    "source": 255,
}


def _text(value: str | None, field_name: str | None = None) -> str | None:
    cleaned = " ".join((value or "").split())
    if not cleaned:
        return None
    limit = _LIMITS.get(field_name) if field_name else None
    return cleaned[:limit] if limit else cleaned


def _column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _raw_headers(headers: list[str | None]) -> list[str]:
    """Header labels for `raw`: a blank header becomes "Column <letter>" and a
    repeated one gets " (2)", so no cell is lost under a shared key."""
    labels: list[str] = []
    seen: dict[str, int] = {}
    for index, header in enumerate(headers):
        label = (header or "").strip() or f"Column {_column_letter(index)}"
        seen[label] = seen.get(label, 0) + 1
        labels.append(label if seen[label] == 1 else f"{label} ({seen[label]})")
    return labels


def _resolve_columns(headers: list[str | None], wanted: dict[str, tuple[str, ...]]) -> tuple[dict, list[str]]:
    positions: dict[str, int] = {}
    keyed = [_header_key(h) for h in headers]
    missing: list[str] = []
    for field_name, spellings in wanted.items():
        for spelling in spellings:
            key = _header_key(spelling)
            if key in keyed:
                positions[field_name] = keyed.index(key)
                break
        else:
            missing.append(spellings[0])
    return positions, missing


@dataclass
class _Parsed:
    row_number: int
    person: str
    values: dict
    raw: dict
    content_hash: str


@dataclass
class _Report:
    skipped: list = field(default_factory=list)
    duplicates: list = field(default_factory=list)
    unmapped: set = field(default_factory=set)
    notes: list = field(default_factory=list)


def _person(name: str, email: str | None, phone: str | None) -> str:
    if email:
        return "e:" + email.lower()
    return "n:" + name.lower() + "|" + _DIGITS.sub("", phone or "")


def _parse_final(get, report: _Report, row_number: int) -> dict | None:
    name = _text(get("name"), "full_name")
    if not name:
        report.skipped.append(SyncRowNote(row_number=row_number, reason="no name"))
        return None
    dept_raw = _text(get("dept"), "dept_raw")
    dept_group, unmapped = normalise.department_group(dept_raw)
    if unmapped:
        report.unmapped.add(dept_raw)
    eligibility_cell = get("eligibility")
    if normalise.eligibility_says_nts(eligibility_cell):
        report.notes.append(SyncRowNote(row_number=row_number, reason="eligibility says NTS"))
    return {
        "full_name": name,
        "email": _text(get("email"), "email"),
        "phone": _text(get("phone"), "phone"),
        "source": _text(get("source"), "source"),
        "applied_on": normalise.final_applied_on(get("applied")),
        "dept_raw": dept_raw,
        "dept_group": dept_group,
        "applied_post": None,
        "eligibility": normalise.eligibility(eligibility_cell),
        "eligibility_raw": _text(eligibility_cell, "eligibility_raw"),
        "sheet_status": normalise.teaching_status(get("status"))[: _LIMITS["sheet_status"]],
        "status_from_remark": False,
        "interview_on_raw": _text(get("interview"), "interview_on_raw"),
        "remarks": _text(get("remarks")),
        "called_by": _text(get("called_by"), "called_by"),
        "resume_url": (get("resume") or "").strip() or None,
    }


def _parse_nts(get, report: _Report, row_number: int) -> dict | None:
    name = _text(get("name"), "full_name")
    if not name:
        report.skipped.append(SyncRowNote(row_number=row_number, reason="no name"))
        return None
    dept_raw = _text(get("dept"), "dept_raw")
    sheet_status, from_remark = normalise.nts_status(get("final_status"), get("status"))
    remarks = " · ".join(part for part in (_text(get("general_remark")), _text(get("remarks"))) if part)
    return {
        "full_name": name,
        "email": _text(get("email"), "email"),
        "phone": _text(get("phone"), "phone"),
        "source": _text(get("source"), "source"),
        "applied_on": normalise.nts_applied_on(get("call_date"), get("interview")),
        "dept_raw": dept_raw,
        # NTS keeps the department as typed (spec section 7, Q3).
        "dept_group": dept_raw,
        "applied_post": _text(get("applied_post"), "applied_post"),
        "eligibility": None,
        "eligibility_raw": None,
        "sheet_status": sheet_status[: _LIMITS["sheet_status"]],
        "status_from_remark": from_remark,
        "interview_on_raw": _text(get("interview"), "interview_on_raw"),
        "remarks": remarks or None,
        "called_by": None,
        "resume_url": None,
    }


def _row_key(person: str, occurrence: int) -> str:
    return hashlib.sha256(f"{person}#{occurrence}".encode()).hexdigest()


def apply_snapshot(db: Session, payload: TalentPoolSyncRequest) -> TalentPoolSyncResult:
    """Apply one tab snapshot. Does not commit: the router does, once."""
    is_final = payload.source_tab == TalentPoolSourceTabEnum.TEACHING_FINAL
    wanted = _FINAL_COLUMNS if is_final else _NTS_COLUMNS
    positions, missing = _resolve_columns(payload.headers, wanted)
    if "name" not in positions:
        raise ValueError(f"No 'Name' column among the headers: {[h for h in payload.headers if h]}")
    raw_labels = _raw_headers(payload.headers)
    parse = _parse_final if is_final else _parse_nts
    report = _Report()

    parsed: list[_Parsed] = []
    for row in payload.rows:
        cells = row.cells

        def get(field_name: str, _cells=cells) -> str | None:
            index = positions.get(field_name)
            return _cells[index] if index is not None and index < len(_cells) else None

        values = parse(get, report, row.row_number)
        if values is None:
            continue
        raw = {label: (cells[i] if i < len(cells) else None) for i, label in enumerate(raw_labels)}
        digest = hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        parsed.append(
            _Parsed(
                row_number=row.row_number,
                person=_person(values["full_name"], values["email"], values["phone"]),
                values=values,
                raw=raw,
                content_hash=digest,
            )
        )

    existing = {
        entry.row_key: entry
        for entry in db.execute(
            select(TalentPoolEntry).where(
                TalentPoolEntry.source_tab == payload.source_tab,
                TalentPoolEntry.row_key.is_not(None),
            )
        ).scalars()
    }

    counts = {
        "received": len(payload.rows),
        "inserted": 0,
        "updated": 0,
        "reactivated": 0,
        "unchanged": 0,
        "deactivated": 0,
    }
    occurrences: dict[str, int] = {}
    first_row_of: dict[str, int] = {}
    seen_keys: set[str] = set()
    for item in parsed:
        occurrence = occurrences.get(item.person, 0) + 1
        occurrences[item.person] = occurrence
        if occurrence == 1:
            first_row_of[item.person] = item.row_number
        else:
            report.duplicates.append(SyncDuplicate(row_number=item.row_number, same_as_row=first_row_of[item.person]))
        key = _row_key(item.person, occurrence)
        seen_keys.add(key)

        entry = existing.get(key)
        if entry is None:
            db.add(
                TalentPoolEntry(
                    source_tab=payload.source_tab,
                    row_key=key,
                    content_hash=item.content_hash,
                    sheet_row_number=item.row_number,
                    raw=item.raw,
                    is_active=True,
                    **item.values,
                )
            )
            counts["inserted"] += 1
        elif entry.content_hash == item.content_hash and entry.is_active:
            # Same cells; the row may still have moved in the sheet.
            if entry.sheet_row_number != item.row_number:
                entry.sheet_row_number = item.row_number
            counts["unchanged"] += 1
        else:
            for name, value in item.values.items():
                setattr(entry, name, value)
            entry.raw = item.raw
            entry.content_hash = item.content_hash
            entry.sheet_row_number = item.row_number
            counts["updated" if entry.is_active else "reactivated"] += 1
            entry.is_active = True

    for key, entry in existing.items():
        if key not in seen_keys and entry.is_active:
            entry.is_active = False
            counts["deactivated"] += 1

    counts["skipped"] = len(report.skipped)
    counts["duplicates"] = len(report.duplicates)

    result = TalentPoolSyncResult(
        source_tab=payload.source_tab,
        sheet_last_update=payload.sheet_last_update,
        counts=counts,
        skipped_rows=report.skipped[:REPORT_CAP],
        duplicate_rows=report.duplicates[:REPORT_CAP],
        unmapped_departments=sorted(report.unmapped)[:REPORT_CAP],
        missing_headers=missing,
        notes=report.notes[:REPORT_CAP],
    )
    # actor=None: n8n holds no User (same as the mail intake). The summary
    # endpoint reads this row for its "last synced" line.
    log_event(
        db,
        actor=None,
        action=TALENT_POOL_SYNCED_ACTION,
        entity_type="TalentPoolSync",
        after_state=result.model_dump(mode="json"),
    )
    return result
