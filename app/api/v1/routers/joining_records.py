"""Joining records read API (docs/specs/joining-screens.md, pipeline brief
Phase 4 step A).

Read-only screens over the four synced sheet tables -- `sheet_joinees`,
`provisional_orders`, `new_departments`, `department_faculty`. The sheets
stay the record and `services/sheet_sync.py` is their only writer, so there
is deliberately no POST/PATCH/DELETE here (decision P1).

Built the same way as `talent_pool.py`, which is the proven pattern:

- Gated with `require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR)`
  -- the Talent Pool's readers (decision P3), no new `PermissionEnum`.
  All three are in `GLOBAL_SCOPE_ROLES` (a test asserts it), so the absence
  of campus scoping is not a leak through a single-campus role; campus is
  only a filter here.
- Every summary count is computed by Postgres and is the SAME clause the
  list filter applies, so every number a screen shows opens a list of
  exactly that length (tests assert each one).
- A NULL normalised value is counted under "none" and the list filters take
  "none" to match it; a blank free-text department is labelled "Not set".
- Lists order with `id` as the final tiebreaker so OFFSET paging is total.
- Only `is_active` rows unless `include_inactive=true`.

Three list filters beyond the spec's list, each added so that a count the
spec asks for can be clicked (see the report / spec's "every count must
equal the list it opens"): joinees `flagged` and `linked_talent_pool`, and
orders `linked`.
"""

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, desc, false, func, nulls_last, or_, select
from sqlalchemy.orm import Session

# The talent pool router's LIKE-escaping and month parsing are exactly what
# these filters need; imported rather than copied so the two cannot drift.
from app.api.v1.routers.talent_pool import _escape_like, _month_bounds
from app.core.deps import get_db, require_roles
from app.models.enums import UserRoleEnum
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
    SOURCE_PRO_APP_ORDER,
    STATE_ACTIVE,
    STATE_LEFT,
    STATE_REJOINED,
    DepartmentFaculty,
    NewDepartment,
    ProvisionalOrder,
    SheetJoinee,
    SheetSyncRun,
)
from app.models.talent_pool_entry import TalentPoolEntry
from app.schemas.common import PaginatedResponse
from app.schemas.joining_records import (
    NONE_KEY,
    ApprovedDepartmentRow,
    CountItem,
    DepartmentsSummary,
    FacultyRead,
    JoineeDetail,
    JoineeRead,
    JoineeSummary,
    LinkedTalentPoolEntry,
    MonthCount,
    OrderRead,
    OrderSummary,
    UnmatchedDepartmentRow,
)

router = APIRouter(prefix="/joining-records", tags=["joining-records"])

_READERS = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)

_MONTHS_SHOWN = 12
_UNDATED = "undated"
_NOT_SET = "Not set"
_DUE_WINDOW_DAYS = 30

# Faculty `state` filter values. "active" = not LEFT: on-leave staff still
# hold the post, so they count towards a department's strength.
_FACULTY_ACTIVE = "active"


# --- shared helpers ----------------------------------------------------------


def _blank(column):
    return column.is_(None) | (func.btrim(column) == "")


def _code_key(column):
    """The summary key a normalised code is counted under: the code, or
    "none" for NULL/blank. Build ONCE per query and reuse it in the GROUP BY
    (see talent_pool.py: a rebuilt expression gets fresh bind parameters and
    Postgres rejects the query)."""
    return func.coalesce(func.nullif(func.btrim(column), ""), NONE_KEY)


def _code_match(column, value: str):
    """The list-side twin of `_code_key`."""
    if value == NONE_KEY:
        return _blank(column)
    return column == value


def _active(model, include_inactive: bool) -> list:
    return [] if include_inactive else [model.is_active.is_(True)]


def _counts(db: Session, column, clauses: list, known: tuple[str, ...]) -> dict[str, int]:
    """{code: n} over `clauses`, zero-filled for `known` and "none". An
    unexpected stored value is kept, never dropped."""
    key = _code_key(column)
    rows = db.execute(select(key, func.count()).where(*clauses).group_by(key)).all()
    out = {k: 0 for k in (*known, NONE_KEY)}
    out.update({k: int(n) for k, n in rows})
    return out


def _search(q: str | None, *columns):
    term = f"%{_escape_like(q.strip())}%"
    return or_(*(c.ilike(term, escape="\\") for c in columns))


def _last_sync_at(db: Session, *sources: str):
    return db.execute(
        select(func.max(SheetSyncRun.created_at)).where(
            SheetSyncRun.source.in_(sources), SheetSyncRun.dry_run.is_(False)
        )
    ).scalar_one()


def _last_twelve_months(today: date) -> list[str]:
    keys = []
    for back in range(_MONTHS_SHOWN - 1, -1, -1):
        m, y = today.month - back, today.year
        while m <= 0:
            m += 12
            y -= 1
        keys.append(f"{y:04d}-{m:02d}")
    return keys


# --- New Joinees -------------------------------------------------------------


def _flagged_row_numbers(db: Session) -> set[int]:
    """Sheet row numbers the latest real New Joinees sync flagged. Flags are
    stored on the run, not the row, and identify a row by its number."""
    run = db.execute(
        select(SheetSyncRun)
        .where(SheetSyncRun.source == SOURCE_NEW_JOINEES, SheetSyncRun.dry_run.is_(False))
        .order_by(desc(SheetSyncRun.created_at))
        .limit(1)
    ).scalar_one_or_none()
    if run is None or not isinstance(run.flagged, list):
        return set()
    return {f["row_number"] for f in run.flagged if isinstance(f, dict) and isinstance(f.get("row_number"), int)}


def _flagged_clause(rows: set[int]):
    # Active rows only: an inactive row's sheet_row_number is from an older
    # snapshot and may now name somebody else's row.
    if not rows:
        return false()
    return SheetJoinee.is_active.is_(True) & SheetJoinee.sheet_row_number.in_(sorted(rows))


@router.get("/joinees/summary", response_model=JoineeSummary)
def joinee_summary(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> JoineeSummary:
    clauses = _active(SheetJoinee, include_inactive)
    total = db.execute(select(func.count()).select_from(SheetJoinee).where(*clauses)).scalar_one()

    campus_key = _code_key(SheetJoinee.campus_code)
    campus_rows = db.execute(
        select(campus_key, func.count()).where(*clauses).group_by(campus_key)
    ).all()
    by_campus = sorted(
        (CountItem(value=v, count=int(n)) for v, n in campus_rows),
        key=lambda item: (item.value == NONE_KEY, -item.count, item.value),
    )

    month_key = func.to_char(SheetJoinee.joined_on, "YYYY-MM")
    month_rows = db.execute(
        select(month_key, func.count())
        .where(*clauses, SheetJoinee.joined_on.is_not(None))
        .group_by(month_key)
    ).all()
    counted = {m: int(n) for m, n in month_rows}
    monthly = [MonthCount(month=k, count=counted.get(k, 0)) for k in _last_twelve_months(date.today())]

    undated = db.execute(
        select(func.count()).select_from(SheetJoinee).where(*clauses, SheetJoinee.joined_on.is_(None))
    ).scalar_one()
    flagged = db.execute(
        select(func.count())
        .select_from(SheetJoinee)
        .where(*clauses, _flagged_clause(_flagged_row_numbers(db)))
    ).scalar_one()
    linked = db.execute(
        select(func.count())
        .select_from(SheetJoinee)
        .where(*clauses, SheetJoinee.talent_pool_entry_id.is_not(None))
    ).scalar_one()

    return JoineeSummary(
        total=int(total),
        by_category=_counts(
            db, SheetJoinee.category, clauses, (CATEGORY_TEACHING, CATEGORY_NON_TEACHING, CATEGORY_HOUSEKEEPING)
        ),
        by_employment_state=_counts(
            db, SheetJoinee.employment_state, clauses, (STATE_ACTIVE, STATE_LEFT, STATE_REJOINED)
        ),
        by_campus=by_campus,
        monthly=monthly,
        undated=int(undated),
        flagged=int(flagged),
        linked_talent_pool=int(linked),
        last_sync_at=_last_sync_at(db, SOURCE_NEW_JOINEES),
    )


@router.get("/joinees", response_model=PaginatedResponse[JoineeRead])
def list_joinees(
    q: str | None = Query(None),
    category: str | None = Query(None),
    employment_state: str | None = Query(None),
    campus_code: str | None = Query(None),
    joined_month: str | None = Query(None),
    flagged: bool = Query(False),
    linked_talent_pool: bool | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> PaginatedResponse[JoineeRead]:
    stmt = select(SheetJoinee).where(*_active(SheetJoinee, include_inactive))
    if category:
        stmt = stmt.where(_code_match(SheetJoinee.category, category))
    if employment_state:
        stmt = stmt.where(_code_match(SheetJoinee.employment_state, employment_state))
    if campus_code:
        stmt = stmt.where(_code_match(SheetJoinee.campus_code, campus_code))
    if joined_month:
        if joined_month == _UNDATED:
            stmt = stmt.where(SheetJoinee.joined_on.is_(None))
        else:
            start, end = _month_bounds(joined_month)
            stmt = stmt.where(SheetJoinee.joined_on >= start, SheetJoinee.joined_on < end)
    if flagged:
        stmt = stmt.where(_flagged_clause(_flagged_row_numbers(db)))
    if linked_talent_pool is not None:
        col = SheetJoinee.talent_pool_entry_id
        stmt = stmt.where(col.is_not(None) if linked_talent_pool else col.is_(None))
    if q and q.strip():
        stmt = stmt.where(
            _search(
                q,
                SheetJoinee.full_name,
                SheetJoinee.bio_id,
                SheetJoinee.new_bio_id,
                SheetJoinee.staff_id,
                SheetJoinee.designation,
                SheetJoinee.department_raw,
                SheetJoinee.dept_new_raw,
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(
                nulls_last(desc(SheetJoinee.joined_on)),
                nulls_last(SheetJoinee.sheet_row_number),
                SheetJoinee.id,
            )
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return PaginatedResponse(
        items=[JoineeRead.model_validate(r) for r in rows], total=int(total), limit=limit, offset=offset
    )


@router.get("/joinees/{joinee_id}", response_model=JoineeDetail)
def get_joinee(
    joinee_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> JoineeDetail:
    joinee = db.get(SheetJoinee, joinee_id)
    if joinee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Joinee not found")
    detail = JoineeDetail.model_validate(joinee)
    if joinee.talent_pool_entry_id is not None:
        entry = db.get(TalentPoolEntry, joinee.talent_pool_entry_id)
        if entry is not None:
            detail.talent_pool_entry = LinkedTalentPoolEntry.model_validate(entry)
    order = db.execute(
        select(ProvisionalOrder)
        .where(ProvisionalOrder.sheet_joinee_id == joinee.id)
        .order_by(
            desc(ProvisionalOrder.is_active),
            nulls_last(desc(ProvisionalOrder.order_on)),
            ProvisionalOrder.id,
        )
        .limit(1)
    ).scalar_one_or_none()
    if order is not None:
        detail.provisional_order = OrderRead.model_validate(order)
    return detail


# --- Provisional Orders ------------------------------------------------------


def _probation_clause(kind: str, today: date):
    end = ProvisionalOrder.probation_end_on
    if kind == "due30":
        return (end >= today) & (end <= today + timedelta(days=_DUE_WINDOW_DAYS))
    if kind == "overdue":
        return (end < today) & _blank(ProvisionalOrder.outcome)
    return end < today  # "ended"


@router.get("/orders/summary", response_model=OrderSummary)
def order_summary(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> OrderSummary:
    clauses = _active(ProvisionalOrder, include_inactive)
    today = date.today()
    row = db.execute(
        select(
            func.count().label("total"),
            func.count().filter(_probation_clause("due30", today)).label("due30"),
            func.count().filter(_probation_clause("overdue", today)).label("overdue"),
            func.count().filter(_probation_clause("ended", today)).label("ended"),
            func.count().filter(ProvisionalOrder.sheet_joinee_id.is_(None)).label("unlinked"),
        ).where(*clauses)
    ).one()
    return OrderSummary(
        total=int(row.total),
        by_order_status=_counts(db, ProvisionalOrder.order_status, clauses, (ORDER_ISSUED, ORDER_PENDING)),
        by_outcome=_counts(
            db,
            ProvisionalOrder.outcome,
            clauses,
            (OUTCOME_PERMANENT_ORDER_RECEIVED, OUTCOME_PROBATION_EXTENDED, OUTCOME_NOT_RECOMMENDED),
        ),
        probation_due30=int(row.due30),
        probation_overdue=int(row.overdue),
        probation_ended=int(row.ended),
        unlinked=int(row.unlinked),
        today=today,
        last_sync_at=_last_sync_at(db, SOURCE_PRO_APP_ORDER),
    )


@router.get("/orders", response_model=PaginatedResponse[OrderRead])
def list_orders(
    q: str | None = Query(None),
    order_status: str | None = Query(None),
    outcome: str | None = Query(None),
    probation: str | None = Query(None, pattern="^(due30|overdue|ended)$"),
    linked: bool | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> PaginatedResponse[OrderRead]:
    stmt = select(ProvisionalOrder).where(*_active(ProvisionalOrder, include_inactive))
    if order_status:
        stmt = stmt.where(_code_match(ProvisionalOrder.order_status, order_status))
    if outcome:
        stmt = stmt.where(_code_match(ProvisionalOrder.outcome, outcome))
    if probation:
        stmt = stmt.where(_probation_clause(probation, date.today()))
    if linked is not None:
        col = ProvisionalOrder.sheet_joinee_id
        stmt = stmt.where(col.is_not(None) if linked else col.is_(None))
    if q and q.strip():
        stmt = stmt.where(
            _search(
                q,
                ProvisionalOrder.full_name,
                ProvisionalOrder.bio_id,
                ProvisionalOrder.emp_id,
                ProvisionalOrder.room_allotted,
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    # A probation filter is a "what is coming up" question, so it reads
    # soonest first; otherwise newest order first.
    primary = (
        nulls_last(ProvisionalOrder.probation_end_on)
        if probation == "due30"
        else nulls_last(desc(ProvisionalOrder.order_on))
    )
    rows = (
        db.execute(
            stmt.order_by(primary, nulls_last(ProvisionalOrder.sheet_row_number), ProvisionalOrder.id)
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return PaginatedResponse(
        items=[OrderRead.model_validate(r) for r in rows], total=int(total), limit=limit, offset=offset
    )


# --- New Departments ---------------------------------------------------------


def _listed_department_ids(include_inactive: bool):
    return select(NewDepartment.id).where(*_active(NewDepartment, include_inactive))


def _matched(include_inactive: bool):
    """A faculty row is matched when it links to a department this screen
    LISTS -- so a row still pointing at a department that left the sheet
    shows as unmatched instead of vanishing from both tables."""
    return DepartmentFaculty.new_department_id.in_(_listed_department_ids(include_inactive))


def _unmatched(include_inactive: bool):
    return DepartmentFaculty.new_department_id.is_(None) | ~_matched(include_inactive)


def _faculty_active():
    return DepartmentFaculty.employment_state.is_(None) | (
        DepartmentFaculty.employment_state != FACULTY_STATE_LEFT
    )


def _faculty_state_clause(state: str):
    if state == _FACULTY_ACTIVE:
        return _faculty_active()
    return _code_match(DepartmentFaculty.employment_state, state)


@router.get("/departments", response_model=DepartmentsSummary)
def departments_summary(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> DepartmentsSummary:
    fac = _active(DepartmentFaculty, include_inactive)
    departments = (
        db.execute(
            select(NewDepartment)
            .where(*_active(NewDepartment, include_inactive))
            .order_by(nulls_last(NewDepartment.name), NewDepartment.id)
        )
        .scalars()
        .all()
    )

    active = _faculty_active()
    per_dept = {
        r.dept_id: r
        for r in db.execute(
            select(
                DepartmentFaculty.new_department_id.label("dept_id"),
                func.count().label("members"),
                func.count().filter(active).label("active"),
                func.count().filter(active & DepartmentFaculty.is_additional.is_(True)).label("active_additional"),
                func.count().filter(DepartmentFaculty.employment_state == FACULTY_STATE_LEFT).label("left"),
                func.count().filter(DepartmentFaculty.employment_state == FACULTY_STATE_ON_LEAVE).label("on_leave"),
            )
            .where(*fac, _matched(include_inactive))
            .group_by(DepartmentFaculty.new_department_id)
        ).all()
    }

    hods: dict[uuid.UUID, list[str]] = {}
    for dept_id, name in db.execute(
        select(DepartmentFaculty.new_department_id, DepartmentFaculty.full_name)
        .where(*fac, _matched(include_inactive), active, DepartmentFaculty.role == ROLE_HOD)
        .order_by(DepartmentFaculty.full_name, DepartmentFaculty.id)
    ).all():
        hods.setdefault(dept_id, []).append(name or "(no name)")

    rows = []
    for d in departments:
        counts = per_dept.get(d.id)
        approved_total = (d.count or 0) + (d.additional_count or 0)
        active_n = int(counts.active) if counts else 0
        rows.append(
            ApprovedDepartmentRow(
                id=d.id,
                name=d.name or _NOT_SET,
                notes=d.notes,
                count=d.count,
                count_raw=d.count_raw,
                additional_count=d.additional_count,
                additional_count_raw=d.additional_count_raw,
                approved_total=approved_total,
                members=int(counts.members) if counts else 0,
                active=active_n,
                active_additional=int(counts.active_additional) if counts else 0,
                left=int(counts.left) if counts else 0,
                on_leave=int(counts.on_leave) if counts else 0,
                hods=hods.get(d.id, []),
                gap=approved_total - active_n,
                is_active=d.is_active,
            )
        )

    label = func.coalesce(func.nullif(func.btrim(DepartmentFaculty.dept_raw), ""), _NOT_SET)
    unmatched_rows = db.execute(
        select(label.label("name"), func.count().label("members"))
        .where(*fac, _unmatched(include_inactive))
        .group_by(label)
        .order_by(desc("members"), label)
    ).all()
    unmatched = [UnmatchedDepartmentRow(name=r.name, members=int(r.members)) for r in unmatched_rows]

    faculty_total = db.execute(select(func.count()).select_from(DepartmentFaculty).where(*fac)).scalar_one()

    return DepartmentsSummary(
        departments=rows,
        unmatched=unmatched,
        faculty_total=int(faculty_total),
        unmatched_total=sum(u.members for u in unmatched),
        last_sync_at=_last_sync_at(db, SOURCE_NEW_DEPARTMENTS, SOURCE_DEPARTMENT_FACULTY),
    )


@router.get("/faculty", response_model=PaginatedResponse[FacultyRead])
def list_faculty(
    q: str | None = Query(None),
    department: str | None = Query(None),
    role: str | None = Query(None),
    state: str | None = Query(None),
    additional: bool | None = Query(None),
    matched: bool | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> PaginatedResponse[FacultyRead]:
    stmt = (
        select(
            DepartmentFaculty,
            NewDepartment.name.label("department_name"),
            SheetJoinee.full_name.label("joinee_name"),
            SheetJoinee.designation.label("joinee_designation"),
        )
        .outerjoin(NewDepartment, NewDepartment.id == DepartmentFaculty.new_department_id)
        .outerjoin(SheetJoinee, SheetJoinee.id == DepartmentFaculty.sheet_joinee_id)
        .where(*_active(DepartmentFaculty, include_inactive))
    )
    if department:
        # An approved name selects that department's linked rows; anything
        # else is an unmatched Faculty-tab name, matched as the departments
        # summary groups it (trimmed, "Not set" = blank).
        dept_id = db.execute(
            select(NewDepartment.id)
            .where(*_active(NewDepartment, include_inactive), NewDepartment.name == department)
            .order_by(NewDepartment.id)
            .limit(1)
        ).scalar_one_or_none()
        if dept_id is not None:
            stmt = stmt.where(DepartmentFaculty.new_department_id == dept_id)
        elif department == _NOT_SET:
            stmt = stmt.where(_unmatched(include_inactive), _blank(DepartmentFaculty.dept_raw))
        else:
            stmt = stmt.where(
                _unmatched(include_inactive), func.btrim(DepartmentFaculty.dept_raw) == department.strip()
            )
    if role:
        stmt = stmt.where(_code_match(DepartmentFaculty.role, role))
    if state:
        stmt = stmt.where(_faculty_state_clause(state))
    if additional is not None:
        stmt = stmt.where(DepartmentFaculty.is_additional.is_(additional))
    if matched is not None:
        stmt = stmt.where(_matched(include_inactive) if matched else _unmatched(include_inactive))
    if q and q.strip():
        stmt = stmt.where(
            _search(q, DepartmentFaculty.full_name, DepartmentFaculty.bio_id, DepartmentFaculty.dept_raw)
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    role_order = case((DepartmentFaculty.role == ROLE_HOD, 0), (DepartmentFaculty.role == ROLE_MEMBER, 1), else_=2)
    rows = db.execute(
        stmt.order_by(
            nulls_last(NewDepartment.name),
            role_order,
            nulls_last(DepartmentFaculty.full_name),
            DepartmentFaculty.id,
        )
        .offset(offset)
        .limit(limit)
    ).all()
    items = [
        FacultyRead(
            id=f.id,
            bio_id=f.bio_id,
            full_name=f.full_name,
            dept_raw=f.dept_raw,
            new_department_id=f.new_department_id,
            department_name=dept_name,
            role=f.role,
            remark_raw=f.remark_raw,
            status_raw=f.status_raw,
            is_additional=f.is_additional,
            top_dept=f.top_dept,
            top25_raw=f.top25_raw,
            employment_state=f.employment_state,
            parent_dept_note=f.parent_dept_note,
            sheet_joinee_id=f.sheet_joinee_id,
            joinee_name=joinee_name,
            joinee_designation=joinee_designation,
            is_active=f.is_active,
            sheet_row_number=f.sheet_row_number,
        )
        for f, dept_name, joinee_name, joinee_designation in rows
    ]
    return PaginatedResponse(items=items, total=int(total), limit=limit, offset=offset)
