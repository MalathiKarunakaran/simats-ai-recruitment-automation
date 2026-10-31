"""New Joinees + Pro App Order + New Departments sync (docs/specs/joinee-order-sync.md).

The only writer of `sheet_joinees`, `provisional_orders`, `new_departments`,
`department_faculty`, `order_register_entries` and `sheet_sync_runs`. Built the same way as `talent_pool_sync.py` (headers
found by name, row_key = person + occurrence, content_hash, deactivate and
never delete, one snapshot applied in the caller's transaction); read that
module's docstring for why. What is different here:

**Privacy first.** Only allowlisted columns are ever looked at: the header
list is resolved against the allowlist below and every other column is
ignored before any row is parsed. `Mobile No.` is in the allowlist only so
it can be read once, in memory, to find a talent pool entry by the last ten
digits of its phone; it is then dropped. It is not stored, not in `raw`, not
in a flag, a log line, an exception message or a run row, and it is not part
of any key (a hash of a ten-digit number is trivially reversible). Error
messages and flags never echo headers or cells from outside the allowlist.

**No Employee writes.** Employee has no BIO ID, so every joiner is "not in
Employees"; that is reported as a count only (decision D3).

**dry_run** does the entity work inside a SAVEPOINT and rolls it back, then
still records the run so the preview shows on the status page.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.sheet_sync import (
    CATEGORY_HOUSEKEEPING,
    CATEGORY_NON_TEACHING,
    CATEGORY_TEACHING,
    FACULTY_STATE_LEFT,
    FACULTY_STATE_ON_LEAVE,
    ORDER_ISSUED,
    ORDER_PENDING,
    OUTCOME_NOT_RECOMMENDED,
    OUTCOME_PERMANENT_ORDER_RECEIVED,
    OUTCOME_PROBATION_EXTENDED,
    ROLE_HOD,
    ROLE_MEMBER,
    SOURCE_DEPARTMENT_FACULTY,
    SOURCE_NEW_DEPARTMENTS,
    SOURCE_NEW_JOINEES,
    SOURCE_ORDER_REGISTER,
    SOURCE_PRO_APP_ORDER,
    STATE_ACTIVE,
    STATE_LEFT,
    STATE_REJOINED,
    DepartmentFaculty,
    NewDepartment,
    OrderRegisterEntry,
    ProvisionalOrder,
    SheetJoinee,
    SheetSyncRun,
)
from app.models.talent_pool_entry import TalentPoolEntry
from app.schemas.sheet_sync import SheetSyncFlag, SheetSyncRequest, SheetSyncResult, SheetSyncSource
from app.services.audit import log_event

SHEET_SYNC_ACTION = "SHEET_SYNC_RUN"

# What the API response carries (same cap as the talent pool sync). The run
# row keeps more, so the flagged-rows Excel is useful on a ~1,200 row tab.
REPORT_CAP = 200
STORED_FLAG_CAP = 2000

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DIGITS = re.compile(r"\D+")
_DASH_DATE = re.compile(r"(\d{1,2})-(\d{1,2})-(\d{4})")
_SLASH_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def _header_key(header: str | None) -> str:
    return _NON_ALNUM.sub(" ", (header or "").lower()).strip()


# field -> accepted header spellings (compared by _header_key). THIS IS THE
# ALLOWLIST: a column that no field names is never read. Never add RBL
# Account number, Salary fixed, Allowance Details, Gender, Current Work or
# S. No+ here.
_JOINEE_COLUMNS = {
    "bio_id": ("BIO ID",),
    "new_bio_id": ("New BIoID",),
    "staff_id": ("Staff ID",),
    "app_no": ("App No",),
    "name": ("Name",),
    "employee_type": ("Employee Type",),
    "college": ("College",),
    "status": ("Status",),
    "joined_on": ("Joined On",),
    "interview_on": ("Interview Date",),
    "prov_order_given_on": ("Provisional Appointment Order Given Date",),
    "designation": ("Designation",),
    "department": ("Department",),
    "dept_new": ("Dept New",),
    "reporting_to": ("Reporting to...", "Reporting to"),
    "relieving_order_submitted": ("Relieving Order Submitted",),
    "original_submitted": ("Original Submitted",),
    "appointment_order": ("Appointment Order",),
    "send_on": ("send date",),
    "received_on": ("Received date",),
    "mobile": ("Mobile No.", "Mobile No"),
}
_ORDER_COLUMNS = {
    "bio_id": ("BioID", "BIO ID"),
    "emp_id": ("EMPID", "EMP ID"),
    "name": ("Name",),
    "order_on": ("Order Date",),
    "probation_end_on": ("Probation Period",),
    # The live tab (30-Oct-2026) calls it "Provision Order".
    "order_status": ("Provision Order", "Order Status"),
    "outcome": ("After Probation Received AO",),
    "id_card": ("ID Card",),
    "food_app": ("Food App",),
    "arms": ("Arms",),
    "app_360": ("360 App",),
    "file_submitted_adfa": ("File Submitted to ADFA",),
    "room_allotted": ("Room Allotted",),
}# S5 (docs/specs/joinee-order-sync.md). Header "#" and "S.No" are not listed,
# so they are never read.
_DEPARTMENT_COLUMNS = {
    "name": ("Approved Department",),
    "notes": ("Notes",),
    "count": ("Count",),
    "additional_count": ("Additional Count",),
}
_FACULTY_COLUMNS = {
    "bio_id": ("Bio ID",),
    "name": ("Name",),
    "dept": ("Dept",),
    "remark": ("Remark",),
    "status": ("Status",),
    "top25": ("Top 25",),
    "vacancy": ("Vacancy",),
    "active": ("Active",),
}
# The paper register of provisional appointment orders. Address, Quali, Month,
# Year, Principal, Collegename and the AutoCrat columns are deliberately NOT
# listed: Address is personal data and none of them is needed.
_REGISTER_COLUMNS = {
    "order_on": ("Date",),
    "order_no": ("Order No",),
    "college": ("College",),
    "bio_id": ("BioID", "BIO ID"),
    "emp_id": ("EMPID", "EMP ID"),
    "name": ("Name",),
    "dept": ("Dept",),
    "grade": ("Grade",),
}

_LIMIT = 255


def _text(value: str | None, limit: int = _LIMIT) -> str | None:
    cleaned = " ".join((value or "").split())
    return cleaned[:limit] if cleaned else None


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


# --- Normalisers (pure) ----------------------------------------------------


def _squash(value: str | None) -> str:
    return " ".join((value or "").split()).lower()


def _date(cell: str | None, pattern: re.Pattern, month_first: bool) -> tuple[date | None, bool]:
    """(parsed, ok). A blank cell is (None, True); text that does not parse is
    (None, False) so the caller can flag it and keep only the raw text."""
    text = (cell or "").strip()
    if not text:
        return None, True
    m = pattern.fullmatch(text)
    if not m:
        return None, False
    a, b, year = map(int, m.groups())
    month, day = (a, b) if month_first else (b, a)
    try:
        return date(year, month, day), True
    except ValueError:
        return None, False


def dd_mm_yyyy(cell: str | None) -> tuple[date | None, bool]:
    return _date(cell, _DASH_DATE, month_first=False)


def m_d_yyyy(cell: str | None) -> tuple[date | None, bool]:
    return _date(cell, _SLASH_DATE, month_first=True)


_CATEGORIES = {"ts": CATEGORY_TEACHING, "nts": CATEGORY_NON_TEACHING, "hk": CATEGORY_HOUSEKEEPING}
_CAMPUSES = {c.lower(): c for c in ("SSE", "SCLAS", "SCAD", "SSPE", "STUDIO", "SPIER", "SHIFT")}
_CAMPUSES["scals"] = "SCLAS"
# The register's own spellings, over and above the campus codes. SHOTS is not
# an app campus; a register row for it is kept and simply never matched.
_REGISTER_COLLEGES = {**_CAMPUSES, "simats engg": "SSE", "shots": "SHOTS"}
_STATES = {
    "new": (STATE_ACTIVE, False),
    "long leave": (STATE_ACTIVE, True),
    "left": (STATE_LEFT, False),
    "resigned": (STATE_LEFT, False),
    "expired": (STATE_LEFT, False),
    "rejoin": (STATE_REJOINED, False),
    "rejoined": (STATE_REJOINED, False),
    "rejoned": (STATE_REJOINED, False),
}
_ORDER_STATUS = {"issued": ORDER_ISSUED, "generated": ORDER_ISSUED, "not issued": ORDER_PENDING, "": ORDER_PENDING}
_OUTCOMES = {
    "received": OUTCOME_PERMANENT_ORDER_RECEIVED,
    "extend probation": OUTCOME_PROBATION_EXTENDED,
    "not satisfied": OUTCOME_NOT_RECOMMENDED,
}


def category(cell: str | None) -> str | None:
    return _CATEGORIES.get(_squash(cell))


def campus_code(cell: str | None) -> str | None:
    return _CAMPUSES.get(_squash(cell))


def register_campus_code(cell: str | None) -> str | None:
    return _REGISTER_COLLEGES.get(_squash(cell))


def employment_state(cell: str | None) -> tuple[str | None, bool]:
    """(state, flag). Unknown spellings, e.g. `Old`, are (None, True)."""
    return _STATES.get(_squash(cell), (None, True))


_ROLES = {"hod": ROLE_HOD, "member": ROLE_MEMBER}
_ADDITIONAL = {"addtional faculty", "additional faculty"}  # the sheet's own spelling first
_INT = re.compile(r"\d+")


def faculty_role(cell: str | None) -> str | None:
    return _ROLES.get(_squash(cell))


def top25(cell: str | None) -> tuple[bool, str | None, str | None]:
    """(top_dept, employment_state, parent_dept_note). The column mixes three
    things; a leading ';' (typo in the sheet) is ignored for matching only."""
    text = _squash(cell).lstrip("; ").strip()
    if not text:
        return False, None, None
    if text == "top dept":
        return True, None, None
    if text in ("left", "resigned"):
        return False, FACULTY_STATE_LEFT, None
    if text in ("leave", "maternity"):
        return False, FACULTY_STATE_ON_LEAVE, None
    return False, None, _text(cell, 100)


def _count(cell: str | None) -> tuple[int | None, bool]:
    text = (cell or "").strip()
    if not text:
        return None, True
    if _INT.fullmatch(text):
        return int(text), True
    return None, False


# --- Plumbing --------------------------------------------------------------


@dataclass
class _Parsed:
    row_number: int
    person: str
    flag_key: str
    values: dict
    raw: dict
    content_hash: str
    mobile: str | None = None


@dataclass
class _Report:
    flags: list = field(default_factory=list)
    skipped: int = 0
    duplicates: int = 0

    def flag(self, row_number: int, key: str | None, reason: str) -> None:
        self.flags.append(SheetSyncFlag(row_number=row_number, key=key, reason=reason))


def _row_key(person: str, occurrence: int) -> str:
    return hashlib.sha256(f"{person}#{occurrence}".encode()).hexdigest()


def _hash(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _last10(value: str | None) -> str | None:
    digits = _DIGITS.sub("", value or "")
    return digits[-10:] if len(digits) >= 10 else None


def _parse_joinee(get, label_of, report: _Report, row_number: int) -> _Parsed | None:
    bio, new_bio, staff = (_text(get(f), 100) for f in ("bio_id", "new_bio_id", "staff_id"))
    name = _text(get("name"))
    joined_cell = get("joined_on")
    if not (bio or new_bio or staff or name):
        # Blank trailing rows are not worth a flag; a row with something in
        # it but nothing to key it on is.
        if any((get(f) or "").strip() for f in _JOINEE_COLUMNS if f != "mobile"):
            report.skipped += 1
            report.flag(row_number, None, "no key (no BIO ID, New BIoID, Staff ID or Name)")
        return None
    if bio:
        person, flag_key = "bio:" + bio.lower(), bio
    elif new_bio:
        person, flag_key = "newbio:" + new_bio.lower(), new_bio
    elif staff:
        person, flag_key = "staff:" + staff.lower(), staff
    else:
        joined_text = _text(joined_cell, 100) or ""
        person, flag_key = f"name:{name.lower()}|{joined_text}", name
    key = flag_key

    values: dict = {
        "bio_id": bio,
        "new_bio_id": new_bio,
        "staff_id": staff,
        "app_no": _text(get("app_no"), 100),
        "full_name": name,
        "employee_type_raw": _text(get("employee_type"), 100),
        "college_raw": _text(get("college"), 100),
        "status_raw": _text(get("status"), 100),
        "designation": _text(get("designation")),
        "department_raw": _text(get("department")),
        "dept_new_raw": _text(get("dept_new")),
        "reporting_to": _text(get("reporting_to")),
        "relieving_order_submitted": _text(get("relieving_order_submitted")),
        "original_submitted": _text(get("original_submitted")),
        "appointment_order": _text(get("appointment_order")),
    }
    values["category"] = category(get("employee_type"))
    if values["category"] is None:
        what = "Employee Type is JRF (no category)" if _squash(get("employee_type")) == "jrf" else "Employee Type not recognised (no category)"
        report.flag(row_number, key, what)
    values["campus_code"] = campus_code(get("college"))
    if values["campus_code"] is None:
        report.flag(row_number, key, "College not recognised (no campus)")
    values["employment_state"], state_flag = employment_state(get("status"))
    if state_flag:
        report.flag(row_number, key, "Status not recognised (no employment state)")
    elif _squash(get("status")) == "long leave":
        report.flag(row_number, key, "Status is Long Leave")
    for attr, header_field, label in (
        ("joined_on", "joined_on", "Joined On"),
        ("interview_on", "interview_on", "Interview Date"),
        ("prov_order_given_on", "prov_order_given_on", "Provisional Appointment Order Given Date"),
        ("send_on", "send_on", "send date"),
        ("received_on", "received_on", "Received date"),
    ):
        parsed, ok = dd_mm_yyyy(get(header_field))
        values[attr] = parsed
        values[attr + "_raw"] = _text(get(header_field), 100)
        if not ok:
            report.flag(row_number, key, f"{label} is not DD-MM-YYYY")

    raw = {label_of[f]: get(f) for f in label_of if f != "mobile"}
    return _Parsed(
        row_number=row_number,
        person=person,
        flag_key=flag_key,
        values=values,
        raw=raw,
        content_hash=_hash(raw),
        mobile=_last10(get("mobile")),
    )


def _parse_order(get, label_of, report: _Report, row_number: int) -> _Parsed | None:
    bio = _text(get("bio_id"), 100)
    if not bio:
        if any((get(f) or "").strip() for f in _ORDER_COLUMNS):
            report.skipped += 1
            report.flag(row_number, None, "no key (no BioID)")
        return None
    values: dict = {
        "bio_id": bio,
        "emp_id": _text(get("emp_id"), 100),
        "full_name": _text(get("name")),
        "order_status_raw": _text(get("order_status"), 100),
        "outcome_raw": _text(get("outcome"), 100),
        "id_card": _text(get("id_card")),
        "food_app": _text(get("food_app")),
        "arms": _text(get("arms")),
        "app_360": _text(get("app_360")),
        "file_submitted_adfa": _text(get("file_submitted_adfa")),
        "room_allotted": _text(get("room_allotted")),
    }
    values["order_on"], ok = dd_mm_yyyy(get("order_on"))
    values["order_on_raw"] = _text(get("order_on"), 100)
    if not ok:
        report.flag(row_number, bio, "Order Date is not DD-MM-YYYY")
    values["probation_end_on"], ok = m_d_yyyy(get("probation_end_on"))
    values["probation_end_on_raw"] = _text(get("probation_end_on"), 100)
    if not ok:
        report.flag(row_number, bio, "Probation Period is not M/D/YYYY")
    values["order_status"] = _ORDER_STATUS.get(_squash(get("order_status")))
    if values["order_status"] is None:
        report.flag(row_number, bio, "Order status not recognised")
    outcome_text = _squash(get("outcome"))
    values["outcome"] = _OUTCOMES.get(outcome_text)
    if values["outcome"] is None and outcome_text:
        report.flag(row_number, bio, "Outcome not recognised (no outcome)")
    if _squash(get("room_allotted")) == "left":
        report.flag(row_number, bio, "Room Allotted says Left")

    raw = {label_of[f]: get(f) for f in label_of}
    return _Parsed(
        row_number=row_number, person="bio:" + bio.lower(), flag_key=bio, values=values, raw=raw, content_hash=_hash(raw)
    )


def _parse_department(get, label_of, report: _Report, row_number: int) -> _Parsed | None:
    name = _text(get("name"))
    if not name:
        if any((get(f) or "").strip() for f in _DEPARTMENT_COLUMNS):
            report.skipped += 1
            report.flag(row_number, None, "no key (no Approved Department)")
        return None
    values: dict = {"name": name, "notes": _text(get("notes"))}
    for attr, field_name, label in (("count", "count", "Count"), ("additional_count", "additional_count", "Additional Count")):
        values[attr], ok = _count(get(field_name))
        values[attr + "_raw"] = _text(get(field_name), 100)
        if not ok:
            report.flag(row_number, name, f"{label} is not a whole number")
    raw = {label_of[f]: get(f) for f in label_of}
    return _Parsed(row_number=row_number, person="dept:" + _squash(name), flag_key=name, values=values, raw=raw,
                   content_hash=_hash(raw))


def _parse_faculty(get, label_of, report: _Report, row_number: int) -> _Parsed | None:
    bio = _text(get("bio_id"), 100)
    if not bio:
        if any((get(f) or "").strip() for f in _FACULTY_COLUMNS):
            report.skipped += 1
            report.flag(row_number, None, "no key (no Bio ID)")
        return None
    values: dict = {
        "bio_id": bio,
        "full_name": _text(get("name")),
        "dept_raw": _text(get("dept")),
        "remark_raw": _text(get("remark"), 100),
        "status_raw": _text(get("status"), 100),
        "top25_raw": _text(get("top25"), 100),
        "vacancy_raw": _text(get("vacancy")),
        "active_raw": _text(get("active")),
    }
    values["role"] = faculty_role(get("remark"))
    if values["role"] is None:
        report.flag(row_number, bio, "Remark not recognised (no role)")
    status_text = _squash(get("status"))
    values["is_additional"] = status_text in _ADDITIONAL
    if status_text and not values["is_additional"]:
        report.flag(row_number, bio, "Status not recognised")
    values["top_dept"], values["employment_state"], values["parent_dept_note"] = top25(get("top25"))
    raw = {label_of[f]: get(f) for f in label_of}
    return _Parsed(row_number=row_number, person="bio:" + bio.lower(), flag_key=bio, values=values, raw=raw,
                   content_hash=_hash(raw))


def _parse_register(get, label_of, report: _Report, row_number: int) -> _Parsed | None:
    order_no = _text(get("order_no"), 100)
    bio = _text(get("bio_id"), 100)
    name = _text(get("name"))
    if not (order_no or bio or name):
        if any((get(f) or "").strip() for f in _REGISTER_COLUMNS):
            report.skipped += 1
            report.flag(row_number, None, "no key (no Order No, BioID or Name)")
        return None
    flag_key = order_no or bio or name
    values: dict = {
        "order_no_raw": order_no,
        "college_raw": _text(get("college"), 100),
        "bio_id": bio,
        "emp_id": _text(get("emp_id"), 100),
        "full_name": name,
        "dept_raw": _text(get("dept")),
        "grade_raw": _text(get("grade")),
    }
    # Digits only: "93" and "093" are the same number. Nine digits at most so
    # the value always fits the integer column.
    seq = int(order_no) if order_no and order_no.isascii() and order_no.isdigit() and len(order_no) <= 9 else None
    values["order_seq"] = seq
    if seq is None:
        report.flag(row_number, flag_key, "Order No is blank" if not order_no else "Order No is not a number")
    values["campus_code"] = register_campus_code(get("college"))
    if values["campus_code"] is None:
        report.flag(row_number, flag_key, "College not recognised (no campus)")
    values["order_date"], ok = dd_mm_yyyy(get("order_on"))
    values["order_date_raw"] = _text(get("order_on"), 100)
    if not ok:
        report.flag(row_number, flag_key, "Date is not DD-MM-YYYY")
    number = str(seq) if seq is not None else "raw:" + _squash(order_no)
    person = f"register:{values['campus_code'] or '-'}|{number}|" + (f"bio:{bio.lower()}" if bio else f"name:{_squash(name)}")
    raw = {label_of[f]: get(f) for f in label_of}
    return _Parsed(
        row_number=row_number, person=person, flag_key=flag_key, values=values, raw=raw, content_hash=_hash(raw)
    )


def _flag_reused_numbers(parsed: list[_Parsed], report: _Report) -> None:
    """The register reuses numbers (SSE 059 for two people). Keep both rows,
    flag every later one."""
    first_row: dict[tuple, int] = {}
    for item in parsed:
        seq = item.values["order_seq"]
        if seq is None or item.values["campus_code"] is None:
            continue
        pair = (item.values["campus_code"], seq)
        if pair in first_row:
            report.flag(item.row_number, item.flag_key, f"order number used twice (same as row {first_row[pair]})")
        else:
            first_row[pair] = item.row_number


def _sync_rows(db: Session, model, parsed: list[_Parsed], report: _Report, counts: dict, link) -> dict:
    """Insert/update/reactivate/deactivate keyed rows of `model`. `link(item)`
    returns extra column values to keep current on every run (links to other
    tables); they never count as a change. Returns {row_key: entity} of the
    rows present in this snapshot."""
    existing = {e.row_key: e for e in db.execute(select(model)).scalars()}
    occurrences: dict[str, int] = {}
    first_row_of: dict[str, int] = {}
    seen: dict[str, object] = {}
    for item in parsed:
        occurrence = occurrences.get(item.person, 0) + 1
        occurrences[item.person] = occurrence
        if occurrence == 1:
            first_row_of[item.person] = item.row_number
        else:
            report.duplicates += 1
            report.flag(item.row_number, item.flag_key, f"key repeats (same as row {first_row_of[item.person]})")
        key = _row_key(item.person, occurrence)
        extra = link(item)
        entity = existing.get(key)
        if entity is None:
            entity = model(
                row_key=key,
                content_hash=item.content_hash,
                sheet_row_number=item.row_number,
                raw=item.raw,
                is_active=True,
                **item.values,
                **extra,
            )
            db.add(entity)
            counts["inserted"] += 1
        elif entity.content_hash == item.content_hash and entity.is_active:
            if entity.sheet_row_number != item.row_number:
                entity.sheet_row_number = item.row_number
            for name, value in extra.items():
                if value is not None and getattr(entity, name) != value:
                    setattr(entity, name, value)
            counts["unchanged"] += 1
        else:
            for name, value in {**item.values, **extra}.items():
                if value is not None or name in item.values:
                    setattr(entity, name, value)
            entity.raw = item.raw
            entity.content_hash = item.content_hash
            entity.sheet_row_number = item.row_number
            counts["updated" if entity.is_active else "reactivated"] += 1
            entity.is_active = True
        seen[key] = entity
    for key, entity in existing.items():
        if key not in seen and entity.is_active:
            entity.is_active = False
            counts["deactivated"] += 1
    return seen


def _talent_pool_index(db: Session) -> dict[str, object]:
    """last-10-digits -> talent pool entry id, over rows the sync wrote (any
    tab). Active rows win over inactive ones."""
    index: dict[str, object] = {}
    rows = db.execute(
        select(TalentPoolEntry.id, TalentPoolEntry.phone, TalentPoolEntry.is_active)
        .where(TalentPoolEntry.row_key.is_not(None), TalentPoolEntry.phone.is_not(None))
        .order_by(TalentPoolEntry.is_active.asc(), TalentPoolEntry.created_at.desc())
    ).all()
    for entry_id, phone, _active in rows:  # later (active, oldest) overwrite earlier
        last10 = _last10(phone)
        if last10:
            index[last10] = entry_id
    return index


_SOURCES = {
    # source -> (allowlist, (required field, header shown when missing), parser)
    SOURCE_NEW_JOINEES: (_JOINEE_COLUMNS, ("name", "Name"), _parse_joinee),
    SOURCE_PRO_APP_ORDER: (_ORDER_COLUMNS, ("bio_id", "BioID"), _parse_order),
    SOURCE_NEW_DEPARTMENTS: (_DEPARTMENT_COLUMNS, ("name", "Approved Department"), _parse_department),
    SOURCE_DEPARTMENT_FACULTY: (_FACULTY_COLUMNS, ("bio_id", "Bio ID"), _parse_faculty),
    SOURCE_ORDER_REGISTER: (_REGISTER_COLUMNS, ("order_no", "Order No"), _parse_register),
}


def _joiner_index(db: Session) -> dict[str, object]:
    """lower(bio id) -> active sheet_joinees id, earliest sheet row wins."""
    joiners = {}
    for j in db.execute(
        select(SheetJoinee).where(SheetJoinee.is_active.is_(True), SheetJoinee.bio_id.is_not(None))
        .order_by(SheetJoinee.sheet_row_number.desc())
    ).scalars():
        joiners[j.bio_id.lower()] = j.id
    return joiners


def _run_entities(db: Session, source: str, payload: SheetSyncRequest, report: _Report, counts: dict):
    wanted, (required, needed), parse = _SOURCES[source]
    positions, missing = _resolve_columns(payload.headers, wanted)
    if required not in positions:
        raise ValueError(f"No '{needed}' column among the recognised headers")
    # The header as the sheet spells it, for the allowlisted columns only.
    label_of = {f: (payload.headers[i] or "").strip() or wanted[f][0] for f, i in positions.items()}

    parsed: list[_Parsed] = []
    for row in payload.rows:
        cells = row.cells

        def get(field_name: str, _cells=cells) -> str | None:
            index = positions.get(field_name)
            return _cells[index] if index is not None and index < len(_cells) else None

        item = parse(get, label_of, report, row.row_number)
        if item is not None:
            parsed.append(item)

    if source == SOURCE_NEW_JOINEES:
        campuses = {c.code: c.id for c in db.execute(select(Campus)).scalars()}
        pool = _talent_pool_index(db) if any(p.mobile for p in parsed) else {}
        linked = 0

        def link(item: _Parsed) -> dict:
            nonlocal linked
            entry_id = pool.get(item.mobile) if item.mobile else None
            if entry_id is not None:
                linked += 1
            return {"campus_id": campuses.get(item.values["campus_code"]), "talent_pool_entry_id": entry_id}

        _sync_rows(db, SheetJoinee, parsed, report, counts, link)
        counts["not_in_employees"] = len(parsed)
        counts["linked_talent_pool"] = linked
    elif source == SOURCE_PRO_APP_ORDER:
        db.flush()
        joiners = _joiner_index(db)

        def link(item: _Parsed) -> dict:
            return {"sheet_joinee_id": joiners.get(item.values["bio_id"].lower())}

        seen = _sync_rows(db, ProvisionalOrder, parsed, report, counts, link)
        counts["linked_joinee"] = sum(1 for e in seen.values() if e.sheet_joinee_id is not None)
        counts["unlinked"] = len(seen) - counts["linked_joinee"]
    elif source == SOURCE_NEW_DEPARTMENTS:
        _sync_rows(db, NewDepartment, parsed, report, counts, lambda item: {})
    elif source == SOURCE_ORDER_REGISTER:
        db.flush()
        joiners = _joiner_index(db)
        _flag_reused_numbers(parsed, report)

        def link(item: _Parsed) -> dict:
            bio = item.values["bio_id"]
            return {"sheet_joinee_id": joiners.get(bio.lower()) if bio else None}

        seen = _sync_rows(db, OrderRegisterEntry, parsed, report, counts, link)
        counts["linked_joinee"] = sum(1 for e in seen.values() if e.sheet_joinee_id is not None)
        counts["unlinked"] = len(seen) - counts["linked_joinee"]
    else:
        db.flush()
        joiners = _joiner_index(db)
        # Exact lookup after case/space folding. A near-miss is flagged, never guessed.
        departments = {
            _squash(d.name): d.id
            for d in db.execute(select(NewDepartment).where(NewDepartment.is_active.is_(True))).scalars()
        }

        def link(item: _Parsed) -> dict:
            dept = item.values["dept_raw"]
            dept_id = departments.get(_squash(dept))
            if dept_id is None:
                report.flag(
                    item.row_number, item.flag_key,
                    "Dept is blank" if not dept else "Dept does not match an approved department",
                )
            return {"new_department_id": dept_id, "sheet_joinee_id": joiners.get(item.flag_key.lower())}

        seen = _sync_rows(db, DepartmentFaculty, parsed, report, counts, link)
        counts["linked_department"] = sum(1 for e in seen.values() if e.new_department_id is not None)
        counts["unlinked_department"] = len(seen) - counts["linked_department"]
        counts["linked_joinee"] = sum(1 for e in seen.values() if e.sheet_joinee_id is not None)
    return missing


def apply_snapshot(db: Session, source: SheetSyncSource | str, payload: SheetSyncRequest, dry_run: bool) -> SheetSyncResult:
    """Apply one tab snapshot. Does not commit: the router does, once."""
    source_value = SheetSyncSource(source).value
    report = _Report()
    counts = {
        "received": len(payload.rows),
        "inserted": 0,
        "updated": 0,
        "reactivated": 0,
        "unchanged": 0,
        "deactivated": 0,
    }
    savepoint = db.begin_nested()
    try:
        missing = _run_entities(db, source_value, payload, report, counts)
        db.flush()
    except Exception:
        savepoint.rollback()
        raise
    if dry_run:
        savepoint.rollback()
    else:
        savepoint.commit()
    counts["skipped"] = report.skipped
    counts["duplicates"] = report.duplicates
    counts["flagged"] = len(report.flags)

    run = SheetSyncRun(
        source=source_value,
        dry_run=dry_run,
        counts=counts,
        flagged=[f.model_dump() for f in report.flags[:STORED_FLAG_CAP]],
        missing_headers=missing,
    )
    db.add(run)
    db.flush()
    # actor=None: the Apps Script holds no User. Counts only, no row detail.
    log_event(
        db,
        actor=None,
        action=SHEET_SYNC_ACTION,
        entity_type="SheetSyncRun",
        entity_id=run.id,
        after_state={"source": source_value, "dry_run": dry_run, "counts": counts, "missing_headers": missing},
    )
    return SheetSyncResult(
        source=SheetSyncSource(source_value),
        dry_run=dry_run,
        run_id=str(run.id),
        counts=counts,
        flagged=report.flags[:REPORT_CAP],
        missing_headers=missing,
    )
