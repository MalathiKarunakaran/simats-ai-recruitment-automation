"""Talent pool read API (2026-10-23), Step A of
docs/specs/talent-pool-dashboard.md.

Three reads and no writes. The Google Sheet is the system of record and the
sync is the only writer of `talent_pool_entries`, so there is deliberately
no POST/PATCH/DELETE in this module -- a screen that could edit a pool entry
would put the app and the sheet in disagreement with no way to settle it.

Gated with `require_roles(HR_ADMIN, SUPER_ADMIN, RECRUITMENT_COORDINATOR)`
(the coordinators were added 2026-10-30 at the user's request) rather than a new
`PermissionEnum` value, following the mail log and the reopen/unpublish
transitions: a tighter gate costs nothing and a new permission would need an
ADD VALUE migration that cannot be undone.

**Pool entries have no campus, so campus scoping does not apply here.** A
sheet row records a person, not a posting, and nobody has yet decided which
campus would hire them -- there is no `campus_id` on the row and nothing
honest to filter on. As with the mail log, every role that can read this is
in `GLOBAL_SCOPE_ROLES` (a test asserts it), so the absence of scoping is not
a leak through a single-campus role.

Every count below is computed by Postgres (`GROUP BY`, `FILTER (WHERE ...)`)
and never by iterating rows in Python. The spec's budget is under 300 ms on
12,000 rows, and the four composite indexes on the model are shaped for
exactly these four groupings.

One deviation from the spec worth knowing: section 2.2 asks for `page` /
`page_size` query parameters while also saying not to invent a new response
envelope. Those two cannot both hold -- this repo's `PaginatedResponse` is
`items/total/limit/offset` and every other list endpoint takes `limit` and
`offset`. The repo convention wins here; the frontend turns its page number
into an offset.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, desc, func, nulls_last, select
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_roles
from app.models.audit_log import AuditLog
from app.models.enums import (
    TALENT_POOL_BREAKDOWN_TOP_N,
    TALENT_POOL_DECIDED_STATUSES,
    TALENT_POOL_ELIGIBILITY_VALUES,
    TALENT_POOL_ELIGIBLE_VALUES,
    TALENT_POOL_NOT_SET_LABEL,
    TALENT_POOL_NTS_STATUSES,
    TALENT_POOL_OTHERS_LABEL,
    TALENT_POOL_PENDING_STATUS,
    TALENT_POOL_SYNCED_ACTION,
    TalentPoolSourceTabEnum,
    UserRoleEnum,
)
from app.models.talent_pool_entry import TalentPoolEntry
from app.schemas.common import PaginatedResponse
from app.schemas.talent_pool import (
    BreakdownItem,
    DepartmentRow,
    MonthlyPoint,
    TalentPoolBreakdowns,
    TalentPoolEntryDetail,
    TalentPoolEntryRead,
    TalentPoolSummary,
)

router = APIRouter(prefix="/talent-pool", tags=["talent-pool"])

_READERS = (UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)

_MONTHS_SHOWN = 12


def _base(source_tab: TalentPoolSourceTabEnum, include_inactive: bool) -> Select:
    """The filter every read starts from, in the order the composite indexes
    are built: tab first, then active."""
    stmt = select(TalentPoolEntry).where(TalentPoolEntry.source_tab == source_tab)
    if not include_inactive:
        stmt = stmt.where(TalentPoolEntry.is_active.is_(True))
    return stmt


def _where(source_tab: TalentPoolSourceTabEnum, include_inactive: bool) -> list:
    clauses = [TalentPoolEntry.source_tab == source_tab]
    if not include_inactive:
        clauses.append(TalentPoolEntry.is_active.is_(True))
    return clauses


def _escape_like(term: str) -> str:
    """Make `%`, `_` and `\\` literal in a user's search term.

    Without this, searching for "100%" matches every row, which reads as a
    broken filter rather than as a wildcard the user did not know they typed.
    The ILIKE below declares `escape="\\"` to match.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ranked(
    db: Session,
    column,
    source_tab: TalentPoolSourceTabEnum,
    include_inactive: bool,
    *,
    case_insensitive: bool = True,
    non_empty_only: bool = False,
) -> list[BreakdownItem]:
    """One breakdown panel: top N by count, the rest folded into "Others".

    "Case-insensitive merge" from spec 1.5 means grouping on
    `lower(trim(x))` but LABELLING with the most frequent original spelling,
    so "mam data" and "Mam Data" count once and display as whichever the
    sheet uses more often. That is done with a window function rather than
    in Python, so only the grouped rows cross the wire.
    """
    clauses = _where(source_tab, include_inactive)
    if non_empty_only:
        clauses.append(column.is_not(None))
        clauses.append(func.btrim(column) != "")

    key = func.lower(func.btrim(column)) if case_insensitive else column
    # One object, used in both the SELECT and the GROUP BY -- see the note in
    # the summary endpoint about why rebuilding it breaks the query.
    label = func.coalesce(func.nullif(func.btrim(column), ""), TALENT_POOL_NOT_SET_LABEL)

    # Count per spelling first, so the label can be the most common one.
    per_spelling = (
        select(key.label("key"), label.label("label"), func.count().label("n"))
        .where(*clauses)
        .group_by(key, label)
        .subquery()
    )

    best_label = (
        select(
            per_spelling.c.key,
            per_spelling.c.label,
            func.sum(per_spelling.c.n).over(partition_by=per_spelling.c.key).label("total"),
            func.row_number()
            .over(partition_by=per_spelling.c.key, order_by=(desc(per_spelling.c.n), per_spelling.c.label))
            .label("rank"),
        )
    ).subquery()

    rows = db.execute(
        select(best_label.c.label, best_label.c.total)
        .where(best_label.c.rank == 1)
        .order_by(desc(best_label.c.total), best_label.c.label)
    ).all()

    top = [BreakdownItem(label=r.label, count=int(r.total)) for r in rows[:TALENT_POOL_BREAKDOWN_TOP_N]]
    rest = rows[TALENT_POOL_BREAKDOWN_TOP_N:]
    if rest:
        top.append(BreakdownItem(label=TALENT_POOL_OTHERS_LABEL, count=sum(int(r.total) for r in rest)))
    return top


def _fixed_order(counts: dict[str, int], order: tuple[str, ...]) -> list[BreakdownItem]:
    """A breakdown shown in a fixed order (spec 1.5's eligibility panel and
    NTS call outcomes) rather than ranked by size. A value outside `order`
    still appears -- appended after the known ones, never dropped, because
    an unexpected spelling in the sheet is exactly what a reader needs to
    see in order to go and fix it."""
    items = [BreakdownItem(label=label, count=counts.get(label, 0)) for label in order]
    extras = sorted((k for k in counts if k not in order), key=lambda k: (-counts[k], k))
    items.extend(BreakdownItem(label=k, count=counts[k]) for k in extras)
    return items


@router.get("/summary", response_model=TalentPoolSummary)
def get_talent_pool_summary(
    source_tab: TalentPoolSourceTabEnum = Query(...),
    dept_mode: str = Query("group", pattern="^(group|raw)$"),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> TalentPoolSummary:
    teaching = source_tab == TalentPoolSourceTabEnum.TEACHING_FINAL
    clauses = _where(source_tab, include_inactive)

    # NTS has no Grouped / As-in-sheet toggle (spec 1.4): its dept_group is
    # just the trimmed name, so honouring dept_mode there would offer a
    # choice between two identical tables.
    mode = dept_mode if teaching else "group"
    dept_col = TalentPoolEntry.dept_group if mode == "group" else TalentPoolEntry.dept_raw

    total = db.execute(select(func.count()).select_from(TalentPoolEntry).where(*clauses)).scalar_one()

    status_rows = db.execute(
        select(TalentPoolEntry.sheet_status, func.count())
        .where(*clauses)
        .group_by(TalentPoolEntry.sheet_status)
    ).all()
    by_status = {s: int(n) for s, n in status_rows}

    by_eligibility: dict[str, int] = {}
    if teaching:
        # Built ONCE and reused. Rebuilding the same coalesce() for the
        # GROUP BY gives it fresh bind parameters, and Postgres then sees two
        # structurally different expressions and rejects the query with
        # "column must appear in the GROUP BY clause" -- an error that reads
        # like a missing GROUP BY rather than a duplicated expression.
        elig_label = func.coalesce(
            func.nullif(func.btrim(TalentPoolEntry.eligibility), ""), TALENT_POOL_NOT_SET_LABEL
        )
        elig_rows = db.execute(
            select(elig_label, func.count()).where(*clauses).group_by(elig_label)
        ).all()
        by_eligibility = {e: int(n) for e, n in elig_rows}

    eligible_pending = 0
    if teaching:
        eligible_pending = db.execute(
            select(func.count())
            .select_from(TalentPoolEntry)
            .where(
                *clauses,
                TalentPoolEntry.eligibility.in_(TALENT_POOL_ELIGIBLE_VALUES),
                TalentPoolEntry.sheet_status == TALENT_POOL_PENDING_STATUS,
            )
        ).scalar_one()

    # --- By department, one grouped query -------------------------------
    # `open` is "not decided": every status other than the three in
    # TALENT_POOL_DECIDED_STATUSES. Computed as a FILTER rather than
    # total - decided so a row with an unexpected status lands in `open`
    # instead of making the columns fail to add up.
    dept_label = func.coalesce(func.nullif(func.btrim(dept_col), ""), TALENT_POOL_NOT_SET_LABEL)
    dept_rows = db.execute(
        select(
            dept_label.label("department"),
            func.count().label("total"),
            func.count()
            .filter(TalentPoolEntry.eligibility.in_(TALENT_POOL_ELIGIBLE_VALUES))
            .label("eligible"),
            func.count().filter(TalentPoolEntry.sheet_status == "Selected").label("selected"),
            func.count().filter(TalentPoolEntry.sheet_status == "Waiting List").label("waiting"),
            func.count().filter(TalentPoolEntry.sheet_status == "Rejected").label("rejected"),
            func.count()
            .filter(TalentPoolEntry.sheet_status.not_in(TALENT_POOL_DECIDED_STATUSES))
            .label("open"),
        )
        .where(*clauses)
        .group_by(dept_label)
        .order_by(desc("total"), dept_label)
    ).all()
    by_department = [
        DepartmentRow(
            department=r.department,
            total=int(r.total),
            eligible=int(r.eligible) if teaching else 0,
            selected=int(r.selected),
            waiting=int(r.waiting),
            rejected=int(r.rejected),
            open=int(r.open),
        )
        for r in dept_rows
    ]

    # --- Monthly, last 12 calendar months -------------------------------
    # Built from a generated month series left-joined to the counts, so a
    # month with no candidates is a zero rather than a missing bar.
    month_key = func.to_char(TalentPoolEntry.applied_on, "YYYY-MM")
    month_rows = db.execute(
        select(
            month_key.label("month"),
            func.count().label("added"),
            func.count().filter(TalentPoolEntry.sheet_status == "Selected").label("selected"),
        )
        .where(*clauses, TalentPoolEntry.applied_on.is_not(None))
        .group_by(month_key)
    ).all()
    counted = {r.month: (int(r.added), int(r.selected)) for r in month_rows}

    today = date.today()
    months: list[MonthlyPoint] = []
    year, month = today.year, today.month
    for back in range(_MONTHS_SHOWN - 1, -1, -1):
        m = month - back
        y = year
        while m <= 0:
            m += 12
            y -= 1
        key = f"{y:04d}-{m:02d}"
        added, selected = counted.get(key, (0, 0))
        months.append(MonthlyPoint(month=key, added=added, selected=selected))

    undated = db.execute(
        select(func.count())
        .select_from(TalentPoolEntry)
        .where(*clauses, TalentPoolEntry.applied_on.is_(None))
    ).scalar_one()

    # --- Breakdown panels ------------------------------------------------
    if teaching:
        breakdowns = TalentPoolBreakdowns(
            eligibility=_fixed_order(by_eligibility, TALENT_POOL_ELIGIBILITY_VALUES),
            source=_ranked(db, TalentPoolEntry.source, source_tab, include_inactive),
            called_by=_ranked(
                db, TalentPoolEntry.called_by, source_tab, include_inactive, non_empty_only=True
            ),
        )
    else:
        # The NTS statuses that are not yet a decision, in the order
        # enums.py lists them -- derived rather than retyped so the panel
        # cannot fall out of step with the canonical tuple.
        nts_outcomes = tuple(
            s for s in TALENT_POOL_NTS_STATUSES if s not in TALENT_POOL_DECIDED_STATUSES
        )
        breakdowns = TalentPoolBreakdowns(
            applied_post=_ranked(db, TalentPoolEntry.applied_post, source_tab, include_inactive),
            source=_ranked(db, TalentPoolEntry.source, source_tab, include_inactive),
            call_outcomes=[
                BreakdownItem(label=label, count=by_status.get(label, 0)) for label in nts_outcomes
            ],
        )

    # --- Freshness, from the sync's own audit row ------------------------
    # None until a sync has run. See TalentPoolSyncInfo's docstring: "never
    # synced" is a real state here, because the read side was built first.
    sync_row = db.execute(
        select(AuditLog)
        .where(AuditLog.action == TALENT_POOL_SYNCED_ACTION)
        .order_by(desc(AuditLog.created_at))
        .limit(1)
    ).scalar_one_or_none()

    last_sync_at = sync_row.created_at if sync_row else None
    sheet_last_update = None
    last_sync_counts = None
    if sync_row and isinstance(sync_row.after_state, dict):
        raw_update = sync_row.after_state.get("sheet_last_update")
        sheet_last_update = raw_update if isinstance(raw_update, str) else None
        raw_counts = sync_row.after_state.get("counts")
        if isinstance(raw_counts, dict):
            last_sync_counts = {k: int(v) for k, v in raw_counts.items() if isinstance(v, int)}

    return TalentPoolSummary(
        source_tab=source_tab,
        total=int(total),
        by_status=by_status,
        by_eligibility=by_eligibility,
        eligible_definition=list(TALENT_POOL_ELIGIBLE_VALUES),
        eligible_pending=int(eligible_pending),
        by_department=by_department,
        department_mode=mode,
        department_count=len(by_department),
        monthly=months,
        undated=int(undated),
        breakdowns=breakdowns,
        last_sync_at=last_sync_at,
        sheet_last_update=sheet_last_update,
        last_sync_counts=last_sync_counts,
    )


@router.get("", response_model=PaginatedResponse[TalentPoolEntryRead])
def list_talent_pool(
    source_tab: TalentPoolSourceTabEnum = Query(...),
    q: str | None = Query(None),
    sheet_status: str | None = Query(None),
    dept_mode: str = Query("group", pattern="^(group|raw)$"),
    department: str | None = Query(None),
    eligibility: str | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> PaginatedResponse[TalentPoolEntryRead]:
    stmt = _base(source_tab, include_inactive)

    if sheet_status:
        stmt = stmt.where(TalentPoolEntry.sheet_status == sheet_status)
    if eligibility:
        stmt = stmt.where(TalentPoolEntry.eligibility == eligibility)
    if department:
        # Matched exactly, against whichever column the caller is viewing,
        # so a department row click filters to precisely that row's count.
        # "Not set" is the label the summary gives a blank, so it has to
        # match blanks here too or clicking that row would return nothing.
        col = (
            TalentPoolEntry.dept_group
            if (dept_mode == "group" or source_tab == TalentPoolSourceTabEnum.NTS)
            else TalentPoolEntry.dept_raw
        )
        if department == TALENT_POOL_NOT_SET_LABEL:
            stmt = stmt.where((col.is_(None)) | (func.btrim(col) == ""))
        else:
            stmt = stmt.where(col == department)

    if q:
        term = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            TalentPoolEntry.full_name.ilike(term, escape="\\")
            | TalentPoolEntry.email.ilike(term, escape="\\")
            | TalentPoolEntry.phone.ilike(term, escape="\\")
            | TalentPoolEntry.dept_raw.ilike(term, escape="\\")
            | TalentPoolEntry.applied_post.ilike(term, escape="\\")
            | TalentPoolEntry.remarks.ilike(term, escape="\\")
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()

    # Nulls last: an entry with no readable date is the least useful thing to
    # put at the top of a register sorted by recency.
    #
    # `id` is the final tiebreaker and it is NOT decoration -- without it the
    # ordering is not total and OFFSET paging is free to repeat a row on one
    # page and skip another. Ties are the normal case here, not the
    # exception: a sync writes every row in one transaction so they all share
    # a `created_at`, and candidates routinely share an applied date. Found
    # by paging a live register and seeing the same candidate on pages 1
    # and 2.
    rows = (
        db.execute(
            stmt.order_by(
                nulls_last(desc(TalentPoolEntry.applied_on)),
                desc(TalentPoolEntry.created_at),
                TalentPoolEntry.id,
            )
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    return PaginatedResponse(
        items=[TalentPoolEntryRead.model_validate(r) for r in rows],
        total=int(total),
        limit=limit,
        offset=offset,
    )


@router.get("/{entry_id}", response_model=TalentPoolEntryDetail)
def get_talent_pool_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: object = Depends(require_roles(*_READERS)),
) -> TalentPoolEntryDetail:
    entry = db.get(TalentPoolEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Talent pool entry not found")
    return TalentPoolEntryDetail.model_validate(entry)
