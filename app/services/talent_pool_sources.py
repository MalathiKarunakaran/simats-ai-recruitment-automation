"""The Source chart's data: the TS tab's Reference column, grouped and by person.

The Final tab only says "Mam Data" or "Our Data". TS says where people came
from, in free text with many spellings, so it is reduced here to a short list.
Director Mam's data and Mam Data are one thing and count as Faculty Plus (the
user's rule, 3-Nov-2026; see talent_pool_attributes.data_source).

Only three columns are read: Phone Number, Mail ID and Reference.
"""

import re
from collections import Counter, defaultdict

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.talent_pool_source_ref import TalentPoolSourceRef

FACULTY_PLUS = "Faculty Plus"
_COLUMNS = {"phone": "phone number", "email": "mail id", "reference": "reference"}
_TEN_DIGITS = re.compile(r"\d{10}")


def source_group(reference: str | None) -> str | None:
    """One TS Reference cell as a chart value. Blank is None; anything that fits
    no group is "Other" rather than a bar of its own."""
    text = re.sub(r"[^a-z0-9]+", " ", (reference or "").lower()).strip()
    squeezed = text.replace(" ", "")
    if not text:
        return None
    if "facultyplus" in squeezed or squeezed in ("directormam", "dmam", "dirmam", "mamdata"):
        return FACULTY_PLUS
    if "indeed" in text:
        return "Indeed"
    if "linkedin" in text:
        return "LinkedIn"
    if re.match(r"what", text):
        return "WhatsApp"
    if re.match(r"re[a-z]*t[a-z]*ment mail|hr mail", text):
        return "Recruitment Mail"
    if text.startswith("mail"):
        return "Mail"
    if re.match(r"dir?e?ct", text):
        return "Direct"
    if text == "call":
        return "Call"
    if text == "new profiles":
        return "New Profiles"
    if text == "hr office":
        return "HR Office"
    if text.startswith("dr ") or text.startswith("mr ") or "faculty" in text:
        return "Faculty Reference"
    return "Other"


def email_key(email: str | None) -> str | None:
    cleaned = (email or "").strip().lower()
    return f"e:{cleaned}" if "@" in cleaned else None


def phone_keys(phone: str | None) -> list[str]:
    digits = _TEN_DIGITS.findall(re.sub(r"[^\d/,]", "", phone or ""))
    return [f"p:{number}" for number in digits]


def apply_snapshot(db: Session, headers: list[str | None], rows: list[list[str | None]], dry_run: bool) -> dict:
    """Replace the table with what the tab says now. A snapshot missing a column,
    or with no rows at all, is refused and the table stays as it was: a renamed
    header must not wipe every source."""
    index = {re.sub(r"[^a-z0-9]+", " ", (h or "").lower()).strip(): i for i, h in enumerate(headers)}
    missing = [name for name in _COLUMNS.values() if name not in index]
    if missing:
        raise ValueError(f"TS columns not found, nothing was updated: {', '.join(missing)}")
    if not rows:
        raise ValueError("The TS tab came back empty, nothing was updated")

    def cell(row: list[str | None], column: str) -> str | None:
        position = index[_COLUMNS[column]]
        return row[position] if position < len(row) else None

    votes: dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        group = source_group(cell(row, "reference"))
        if group is None:
            continue
        for key in [email_key(cell(row, "email")), *phone_keys(cell(row, "phone"))]:
            if key:
                votes[key][group] += 1
    # A person listed more than once takes their most frequent source.
    wanted = {key: sorted(counter.items(), key=lambda item: (-item[1], item[0]))[0][0] for key, counter in votes.items()}

    existing = dict(db.execute(select(TalentPoolSourceRef.match_key, TalentPoolSourceRef.source)).tuples().all())
    changed = wanted != existing
    if changed and not dry_run:
        db.execute(delete(TalentPoolSourceRef))
        db.add_all(TalentPoolSourceRef(match_key=key, source=source) for key, source in wanted.items())
        db.flush()
    return {"received": len(rows), "keys": len(wanted), "changed": int(changed)}
