"""Selection batches (docs/specs/selection-batches.md), the only writer of
`selection_batches` and `selection_batch_members`.

A batch picks Talent Pool rows whose sheet status is Selected and snapshots
the list columns; no Application is created and the sheet stays the source
of each person's status (decision D1). Every write logs an audit event with
the actor. Callers (the router) commit.

**Uniqueness of a person across batches** is checked here (a person may be in
only one batch that is not withdrawn, D4). The status lives on the batch, so
a partial unique index on the member table cannot express it; two requests
racing for the same person could both pass the check. The people who can call
this are a handful of coordinators, so that is accepted rather than locked.

**Batch numbers** SB-YYYY-NNN count this year's batches (withdrawn ones
included, so a number is never reused); the unique constraint is the real
guarantee and a collision surfaces as a 409 to retry.
"""

import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.enums import StaffRoleCategoryEnum, TalentPoolSourceTabEnum
from app.models.selection_batch import (
    BATCH_LIVE_STATUSES,
    BATCH_SENT_TO_UNIVERSITY,
    BATCH_UNIVERSITY_APPROVED,
    BATCH_WITHDRAWN,
    SelectionBatch,
    SelectionBatchMember,
)
from app.models.talent_pool_entry import TalentPoolEntry
from app.models.user import User
from app.schemas.selection_batch import SelectionBatchCreate
from app.services.audit import log_event

SELECTED_STATUS = "Selected"
_SEQUENCE_WIDTH = 3


def next_batch_no(db: Session, *, today: date | None = None) -> str:
    year = (today or datetime.now(timezone.utc).date()).year
    prefix = f"SB-{year}-"
    used = db.query(func.count(SelectionBatch.batch_no)).filter(SelectionBatch.batch_no.like(f"{prefix}%")).scalar() or 0
    return f"{prefix}{used + 1:0{_SEQUENCE_WIDTH}d}"


def membership(db: Session, entry_ids: list[uuid.UUID]) -> dict[str, str]:
    """{entry_id: batch_no} for entries that sit in a batch that is not withdrawn."""
    if not entry_ids:
        return {}
    rows = db.execute(
        select(SelectionBatchMember.talent_pool_entry_id, SelectionBatch.batch_no)
        .join(SelectionBatch, SelectionBatch.id == SelectionBatchMember.batch_id)
        .where(
            SelectionBatchMember.talent_pool_entry_id.in_(entry_ids),
            SelectionBatch.status.in_(BATCH_LIVE_STATUSES),
        )
    ).all()
    return {str(entry_id): batch_no for entry_id, batch_no in rows}


def _category(entry: TalentPoolEntry) -> str:
    if entry.source_tab == TalentPoolSourceTabEnum.TEACHING_FINAL:
        return StaffRoleCategoryEnum.TEACHING.value
    return StaffRoleCategoryEnum.NON_TEACHING.value


def _snapshot(entry: TalentPoolEntry, designation: str | None, salary: str | None, position: int) -> SelectionBatchMember:
    is_final = entry.source_tab == TalentPoolSourceTabEnum.TEACHING_FINAL
    return SelectionBatchMember(
        talent_pool_entry_id=entry.id,
        position=position,
        full_name=entry.full_name,
        # NTS has the post it applied for; Final has none, so only what was typed.
        designation=designation or (None if is_final else entry.applied_post),
        department=entry.dept_group if is_final else entry.dept_raw,
        category=_category(entry),
        qualification=entry.eligibility_raw,
        experience=None,
        panel_remarks=entry.remarks,
        proposed_salary=salary,
    )


def create_batch(db: Session, *, actor: User, payload: SelectionBatchCreate) -> SelectionBatch:
    ids = [m.talent_pool_entry_id for m in payload.members]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A person is listed more than once")
    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campus not found")

    entries = {e.id: e for e in db.execute(select(TalentPoolEntry).where(TalentPoolEntry.id.in_(ids))).scalars()}
    if len(entries) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Talent pool entry not found")
    ineligible = [
        e.full_name
        for e in entries.values()
        if not e.is_active or " ".join((e.sheet_status or "").split()).lower() != SELECTED_STATUS.lower()
    ]
    if ineligible:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Only active talent pool entries with status Selected can be sent: " + ", ".join(sorted(ineligible)),
        )
    taken = membership(db, ids)
    if taken:
        names = [f"{entries[uuid.UUID(i)].full_name} ({no})" for i, no in taken.items()]
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Already in a selection batch: " + ", ".join(sorted(names))
        )

    batch = SelectionBatch(
        batch_no=next_batch_no(db),
        status=BATCH_SENT_TO_UNIVERSITY,
        campus_id=payload.campus_id,
        note=payload.note,
        created_by_id=actor.id,
        sent_on=payload.sent_on or datetime.now(timezone.utc).date(),
    )
    batch.members = [
        _snapshot(entries[m.talent_pool_entry_id], m.designation, m.proposed_salary, position)
        for position, m in enumerate(payload.members)
    ]
    try:
        with db.begin_nested():
            db.add(batch)
            db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Batch number was taken at the same moment; please retry") from exc
    log_event(
        db,
        actor=actor,
        action="SELECTION_BATCH_CREATED",
        entity_type="SelectionBatch",
        entity_id=batch.id,
        after_state={
            "batch_no": batch.batch_no,
            "status": batch.status,
            "campus_id": batch.campus_id,
            "members": [str(i) for i in ids],
        },
    )
    return batch


def record_university_approval(
    db: Session, *, actor: User, batch: SelectionBatch, ref_no: str, approved_on: date
) -> SelectionBatch:
    if batch.status != BATCH_SENT_TO_UNIVERSITY:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Approval can only be recorded for a batch sent to the University (this one is {batch.status})"
        )
    batch.status = BATCH_UNIVERSITY_APPROVED
    batch.university_ref_no = ref_no
    batch.university_approved_on = approved_on
    batch.approval_recorded_by_id = actor.id
    db.flush()
    log_event(
        db,
        actor=actor,
        action="SELECTION_BATCH_UNIVERSITY_APPROVED",
        entity_type="SelectionBatch",
        entity_id=batch.id,
        before_state={"status": BATCH_SENT_TO_UNIVERSITY},
        after_state={"batch_no": batch.batch_no, "status": batch.status, "university_ref_no": ref_no, "university_approved_on": approved_on},
    )
    return batch


def withdraw(db: Session, *, actor: User, batch: SelectionBatch, reason: str | None) -> SelectionBatch:
    if batch.status != BATCH_SENT_TO_UNIVERSITY:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Only a batch still waiting on the University can be withdrawn (this one is {batch.status})"
        )
    before = batch.status
    # Members stay as the record of what was sent; withdrawing the batch is
    # what frees them, because membership() ignores WITHDRAWN batches.
    batch.status = BATCH_WITHDRAWN
    db.flush()
    log_event(
        db,
        actor=actor,
        action="SELECTION_BATCH_WITHDRAWN",
        entity_type="SelectionBatch",
        entity_id=batch.id,
        before_state={"status": before},
        after_state={"batch_no": batch.batch_no, "status": batch.status, "reason": reason},
    )
    return batch
