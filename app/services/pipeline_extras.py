"""Dashboard "Joining pipeline" tiles and the pipeline chart's trailing bars
(pipeline-completion brief, "Dashboard additions (append only)").

Served by its own endpoint, `GET /dashboard/pipeline-extras`, so the
`/dashboard/kpis` response -- and every tile, number and funnel bucket the
e2e suite checks against it -- stays exactly as it was.

Production has no Applications yet (user decision 31-Oct-2026), so each tile
is the in-app source PLUS the synced sheet source, returned as separate
parts so the page can show the breakdown:

- waitlisted: Applications WAITLISTED + active Talent Pool entries whose
  sheet status is "Waiting List", per tab.
- sent_to_university: members of selection batches still SENT_TO_UNIVERSITY.
- provisional_orders_this_month: active order-register rows plus ISSUED
  in-app appointment orders, both dated in the current calendar month in
  India (IST is a fixed +05:30, no DST, so no tz database is needed).
- awaiting_hod_review: Applications HANDED_OVER_TO_HOD + sheet provisional
  orders whose probation is overdue. "Overdue" is the Provisional Orders
  page's own clause, IMPORTED from joining_records, with the same
  `date.today()`, so the two numbers cannot disagree.
- awaiting_permanent_order: Applications HOD_REVIEW_COMPLETE.

Campus: the dashboard's campus filter narrows every source that has a campus
(applications, appointment orders, selection batches, the register's
campus_code). Talent Pool entries and sheet provisional orders carry no
campus, so they are always all-campus; `sheet_ignores_campus` says so.

Access: the sheet mirrors and selection batches are readable only by
SUPER_ADMIN / HR_ADMIN / RECRUITMENT_COORDINATOR (their own routers'
require_roles). For anyone else those parts are None and left out of the
totals, rather than this endpoint quietly widening who can see them.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import false, func, select
from sqlalchemy.orm import Session

# The Provisional Orders page's overdue clause and FROM (order + app mark).
# Imported, never copied, so the dashboard's number is the page's number.
from app.api.v1.routers.joining_records import _ORDERS_FROM, _probation_clause
from app.core.deps import CampusScope
from app.models.appointment_order import APPOINTMENT_ORDER_ISSUED, AppointmentOrder
from app.models.application import Application
from app.models.campus import Campus
from app.models.enums import ApplicationStatusEnum, TalentPoolSourceTabEnum, UserRoleEnum
from app.models.selection_batch import BATCH_SENT_TO_UNIVERSITY, SelectionBatch, SelectionBatchMember
from app.models.sheet_sync import OrderRegisterEntry, ProvisionalOrder
from app.models.talent_pool_entry import TalentPoolEntry
from app.services.scoping import resolve_campus_filter

SHEET_READER_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN, UserRoleEnum.RECRUITMENT_COORDINATOR)
IST = timezone(timedelta(hours=5, minutes=30))
WAITING_LIST_STATUS = "Waiting List"


def india_today() -> date:
    return datetime.now(IST).date()


def _month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    end = (start + timedelta(days=32)).replace(day=1)
    return start, end


def _total(*parts: int | None) -> int:
    return sum(p for p in parts if p is not None)


def get_pipeline_extras(
    db: Session,
    scope: CampusScope,
    *,
    role: UserRoleEnum,
    campus_code: str | None = None,
    month_of: date | None = None,
    today: date | None = None,
) -> dict:
    """`month_of` (default: today in India) picks the calendar month for the
    orders tile; `today` (default: `date.today()`, exactly what the
    Provisional Orders summary uses) is the overdue cut-off. Both exist so
    tests can pin a boundary."""
    campus_id_filter, scope_note = resolve_campus_filter(db, scope, campus_code)
    month_start, month_end = _month_bounds(month_of or india_today())
    overdue_today = today or date.today()
    sheet_visible = role in SHEET_READER_ROLES

    def app_count(status: ApplicationStatusEnum) -> int:
        stmt = select(func.count()).select_from(Application).where(Application.status == status)
        if campus_id_filter is not None:
            stmt = stmt.where(Application.campus_id == campus_id_filter)
        return int(db.execute(stmt).scalar_one())

    # --- Waitlisted -------------------------------------------------------
    waitlisted_apps = app_count(ApplicationStatusEnum.WAITLISTED)
    pool_final = pool_nts = None
    if sheet_visible:
        rows = dict(
            db.execute(
                select(TalentPoolEntry.source_tab, func.count())
                .where(TalentPoolEntry.is_active.is_(True), TalentPoolEntry.sheet_status == WAITING_LIST_STATUS)
                .group_by(TalentPoolEntry.source_tab)
            ).all()
        )
        pool_final = int(rows.get(TalentPoolSourceTabEnum.TEACHING_FINAL, 0))
        pool_nts = int(rows.get(TalentPoolSourceTabEnum.NTS, 0))

    # --- Sent to University (pending) ---------------------------------------
    batches = members = None
    if sheet_visible:
        batch_where = [SelectionBatch.status == BATCH_SENT_TO_UNIVERSITY]
        if campus_id_filter is not None:
            batch_where.append(SelectionBatch.campus_id == campus_id_filter)
        batches = int(db.execute(select(func.count()).select_from(SelectionBatch).where(*batch_where)).scalar_one())
        members = int(
            db.execute(
                select(func.count())
                .select_from(SelectionBatchMember)
                .join(SelectionBatch, SelectionBatchMember.batch_id == SelectionBatch.id)
                .where(*batch_where)
            ).scalar_one()
        )

    # --- Provisional orders issued (this month) ------------------------------
    order_where = [
        AppointmentOrder.status == APPOINTMENT_ORDER_ISSUED,
        AppointmentOrder.order_date >= month_start,
        AppointmentOrder.order_date < month_end,
    ]
    if campus_id_filter is not None:
        order_where.append(AppointmentOrder.campus_id == campus_id_filter)
    appointment_orders = int(
        db.execute(select(func.count()).select_from(AppointmentOrder).where(*order_where)).scalar_one()
    )
    register = None
    if sheet_visible:
        register_where = [
            OrderRegisterEntry.is_active.is_(True),
            OrderRegisterEntry.order_date >= month_start,
            OrderRegisterEntry.order_date < month_end,
        ]
        if campus_id_filter is not None:
            campus = db.get(Campus, campus_id_filter)
            register_where.append(OrderRegisterEntry.campus_code == campus.code if campus else false())
        register = int(
            db.execute(select(func.count()).select_from(OrderRegisterEntry).where(*register_where)).scalar_one()
        )

    # --- Awaiting HOD review / permanent order -------------------------------
    hod_apps = app_count(ApplicationStatusEnum.HANDED_OVER_TO_HOD)
    sheet_overdue = None
    if sheet_visible:
        sheet_overdue = int(
            db.execute(
                select(func.count())
                .select_from(_ORDERS_FROM)
                .where(ProvisionalOrder.is_active.is_(True), _probation_clause("overdue", overdue_today))
            ).scalar_one()
        )
    hod_complete_apps = app_count(ApplicationStatusEnum.HOD_REVIEW_COMPLETE)

    # --- Pipeline chart: trailing bars --------------------------------------
    # Appended after the chart's existing bars. The application stages are
    # the same current-snapshot status counts as the funnel; they overlap the
    # funnel's "Joined" bucket on purpose (that bucket is unchanged).
    # "Sent to University" counts batch members, so it is left out for a
    # caller who cannot see selection batches.
    pipeline_extension = []
    if members is not None:
        pipeline_extension.append({"stage": "Sent to University", "count": members})
    pipeline_extension += [
        {"stage": "Provisional order issued", "count": app_count(ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED)},
        {"stage": "HOD review complete", "count": hod_complete_apps},
        {"stage": "Permanent order issued", "count": app_count(ApplicationStatusEnum.PERMANENT_ORDER_ISSUED)},
    ]

    return {
        "scope_note": scope_note,
        "sheet_visible": sheet_visible,
        "sheet_ignores_campus": True,
        "month": month_start.strftime("%Y-%m"),
        "today": overdue_today,
        "waitlisted": {
            "total": _total(waitlisted_apps, pool_final, pool_nts),
            "applications": waitlisted_apps,
            "talent_pool_final": pool_final,
            "talent_pool_nts": pool_nts,
        },
        "sent_to_university": {"total": _total(members), "batches": batches, "members": members},
        "provisional_orders_this_month": {
            "total": _total(register, appointment_orders),
            "order_register": register,
            "appointment_orders": appointment_orders,
        },
        "awaiting_hod_review": {
            "total": _total(hod_apps, sheet_overdue),
            "applications": hod_apps,
            "sheet_overdue": sheet_overdue,
        },
        "awaiting_permanent_order": {"total": hod_complete_apps, "applications": hod_complete_apps},
        "pipeline_extension": pipeline_extension,
    }
