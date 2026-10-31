"""The only writer of `provisional_order_marks` (docs/specs/joining-screens.md,
Step A2).

A marker sets checklist items on a provisional order in the app; the app
mark wins over the synced sheet value and the sheet is never written to.
Setting a field to None CLEARS the app mark, so that item falls back to
the sheet's value again. Each call that changes anything writes ONE audit
row with the before/after of the changed fields only.

This module also owns how a sheet cell reads as Done / Not done, so the
list, the sheet panel and the tests agree on it. The sheet's own words
(30-Oct-2026): ID Card "Collected" / "Not Colleted", Food App and Arms
"Created" / "Not Created", 360 App "Filled" / "Not Filled", ADFA "YES" or
blank. Anything starting with "not" is Not done; a blank is "not
recorded" (None); an unrecognised word is also None and the raw text is
shown beside it.
"""

from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.provisional_order_mark import (
    MARK_FIELDS,
    OUTCOME_FAMILY_WAY,
    OUTCOME_LEFT,
    OUTCOME_LONG_LEAVE,
    OUTCOME_NO_SUBMIT_PG,
    OUTCOME_REJOIN,
    OUTCOME_TRA,
    ProvisionalOrderMark,
)
from app.models.sheet_sync import ProvisionalOrder
from app.models.user import User
from app.services.audit import log_event

MARK_ACTION = "PROVISIONAL_ORDER_MARKED"

# Checklist mark field -> the sheet column it overrides.
CHECKLIST_SHEET_COLUMN = {
    "id_card_done": "id_card",
    "food_app_done": "food_app",
    "arms_done": "arms",
    "app_360_done": "app_360",
    "adfa_file_done": "file_submitted_adfa",
}
# Mark field -> sheet column, for the fields that have one at all.
SHEET_COLUMN = {
    **CHECKLIST_SHEET_COLUMN,
    "room_allotted": "room_allotted",
    "order_status": "order_status",
    "outcome": "outcome",
}

# Outcome words the sheet writes that the sync leaves un-normalised (outcome
# NULL, outcome_raw only). The READ layer maps them, so these people count
# under their outcome and not as "no outcome" / overdue. Keys are the raw
# text trimmed, lower-cased, inner spaces collapsed -- the router's SQL CASE
# folds the same way, and `sheet_outcome` below is its Python twin.
RAW_ONLY_OUTCOMES = {
    "left": OUTCOME_LEFT,
    "rejoin": OUTCOME_REJOIN,
    "tra": OUTCOME_TRA,
    "family way": OUTCOME_FAMILY_WAY,
    "no submit pg": OUTCOME_NO_SUBMIT_PG,
    "long leave": OUTCOME_LONG_LEAVE,
}

_DONE_WORDS = {"collected", "created", "filled", "yes", "y", "done", "submitted"}
# A date only makes sense when its yes/no is yes.
_DATE_NEEDS = {"registrar_order_date": "registrar_order_issued", "orientation_date": "orientation_conducted"}


def sheet_done(text: str | None) -> bool | None:
    """How a sheet checklist cell reads: True (done), False (not done), or
    None (blank or a word nobody mapped)."""
    word = " ".join((text or "").split()).lower()
    if not word:
        return None
    if word.startswith("not") or word in {"no", "n"}:
        return False
    if word in _DONE_WORDS:
        return True
    return None


def sheet_outcome(order: ProvisionalOrder) -> str | None:
    """The sheet's outcome as the read layer sees it: the sync's normalised
    value, else a raw-only word mapped by RAW_ONLY_OUTCOMES."""
    if order.outcome:
        return order.outcome
    return RAW_ONLY_OUTCOMES.get(" ".join((order.outcome_raw or "").split()).lower())


def sheet_value(order: ProvisionalOrder, field: str):
    if field == "outcome":
        return sheet_outcome(order)
    column = SHEET_COLUMN.get(field)
    if column is None:
        return None
    value = getattr(order, column)
    return sheet_done(value) if field in CHECKLIST_SHEET_COLUMN else value


def get_mark(db: Session, order_id) -> ProvisionalOrderMark | None:
    return db.execute(
        select(ProvisionalOrderMark).where(ProvisionalOrderMark.provisional_order_id == order_id)
    ).scalar_one_or_none()


def set_marks(db: Session, order: ProvisionalOrder, changes: dict, actor: User) -> ProvisionalOrderMark | None:
    """Apply `changes` ({field: value}, value None = clear the app mark).
    Fields left out are untouched. Does not commit: the router does."""
    unknown = set(changes) - set(MARK_FIELDS)
    if unknown:
        raise ValueError(f"Not markable: {sorted(unknown)}")

    mark = get_mark(db, order.id)
    current = {f: getattr(mark, f) if mark else None for f in MARK_FIELDS}
    after_all = {**current, **changes}
    for date_field, flag in _DATE_NEEDS.items():
        if after_all[date_field] is not None and after_all[flag] is not True:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{date_field} can only be set when {flag} is true",
            )

    changed = [f for f in MARK_FIELDS if f in changes and changes[f] != current[f]]
    if not changed:
        return mark

    if mark is None:
        mark = ProvisionalOrderMark(provisional_order_id=order.id, marked={})
        db.add(mark)
    now = datetime.now(timezone.utc)
    marked = dict(mark.marked or {})
    for field in changed:
        setattr(mark, field, changes[field])
        if changes[field] is None:
            marked.pop(field, None)
        else:
            marked[field] = {"by_user_id": str(actor.id), "by_name": actor.full_name, "at": now.isoformat()}
    mark.marked = marked  # a new dict, so the JSONB change is detected
    db.flush()

    log_event(
        db,
        actor=actor,
        action=MARK_ACTION,
        entity_type="ProvisionalOrder",
        entity_id=order.id,
        before_state={f: _plain(current[f]) for f in changed},
        after_state={f: _plain(changes[f]) for f in changed},
    )
    return mark


def _plain(value):
    return value.isoformat() if isinstance(value, date) else value
