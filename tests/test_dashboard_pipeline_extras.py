"""GET /dashboard/pipeline-extras -- the "Joining pipeline" tiles and the
pipeline chart's trailing bars (app/services/pipeline_extras.py).

Hand-countable fixtures with literal expectations. Application statuses are
set directly on the row: these tests count statuses, they do not exercise
the pipeline's transition rules (test_pipeline* does that)."""

import uuid
from datetime import date, datetime, timedelta, timezone

from app.core.deps import CampusScope
from app.models.appointment_order import APPOINTMENT_ORDER_CANCELLED, APPOINTMENT_ORDER_ISSUED, AppointmentOrder
from app.models.enums import ApplicationStatusEnum, StaffRoleCategoryEnum, TalentPoolSourceTabEnum, UserRoleEnum
from app.models.provisional_order_mark import ProvisionalOrderMark
from app.models.selection_batch import (
    BATCH_SENT_TO_UNIVERSITY,
    BATCH_UNIVERSITY_APPROVED,
    SelectionBatch,
    SelectionBatchMember,
)
from app.models.sheet_sync import OrderRegisterEntry, ProvisionalOrder
from app.models.talent_pool_entry import TalentPoolEntry
from app.services import pipeline_extras

from tests.conftest import auth_headers

URL = "/api/v1/dashboard/pipeline-extras"


def _add(db, obj):
    db.add(obj)
    db.flush()
    return obj


def _get(client, user, **params):
    response = client.get(URL, headers=auth_headers(client, user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _app(application_factory, vacancy, status):
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    application.status = status
    return application


def _pool(db, tab, status, active=True):
    return _add(
        db,
        TalentPoolEntry(
            source_tab=tab, full_name=f"P {uuid.uuid4().hex[:6]}", sheet_status=status, is_active=active, raw={}
        ),
    )


def _batch(db, actor, status, campus, n_members):
    batch = _add(
        db,
        SelectionBatch(
            batch_no=f"SB-{uuid.uuid4().hex[:6]}",
            status=status,
            campus_id=campus.id if campus else None,
            created_by_id=actor.id,
            sent_on=date.today(),
        ),
    )
    for i in range(n_members):
        entry = _pool(db, TalentPoolSourceTabEnum.TEACHING_FINAL, "Selected")
        _add(db, SelectionBatchMember(batch_id=batch.id, talent_pool_entry_id=entry.id, position=i, full_name=entry.full_name))
    return batch


def _appointment(db, application, actor, order_date, status=APPOINTMENT_ORDER_ISSUED):
    seq = abs(hash(uuid.uuid4())) % 10**6
    return _add(
        db,
        AppointmentOrder(
            application_id=application.id,
            campus_id=application.campus_id,
            sequence=seq,
            order_number=f"AO-{seq}",
            order_date=order_date,
            status=status,
            issued_by_id=actor.id,
            issued_at=datetime.now(timezone.utc),
            candidate_name="X",
            designation="Assistant Professor",
            category="TEACHING",
            campus_code="SSE",
            college_name="College",
            principal_name="Principal",
            department_name="Dept",
            probation_end_date=order_date + timedelta(days=180),
        ),
    )


def _register(db, order_date, campus_code="SSE", active=True):
    return _add(
        db,
        OrderRegisterEntry(
            row_key=uuid.uuid4().hex, order_date=order_date, campus_code=campus_code, is_active=active, raw={}
        ),
    )


def _sheet_order(db, probation_end_on, active=True, **kw):
    return _add(
        db,
        ProvisionalOrder(
            row_key=uuid.uuid4().hex, full_name="O", probation_end_on=probation_end_on, is_active=active, raw={}, **kw
        ),
    )


# --- Waitlisted -------------------------------------------------------------


def test_waitlisted_is_applications_plus_both_pool_tabs(client, db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=3)
    _app(application_factory, vacancy, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, vacancy, ApplicationStatusEnum.REJECTED)
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Waiting List")
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Waiting List")
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Waiting List", active=False)
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Selected")
    _pool(db_session, TalentPoolSourceTabEnum.NTS, "Waiting List")
    db_session.commit()

    body = _get(client, vacancy.hr_admin)
    assert body["waitlisted"] == {
        "total": 4,
        "applications": 1,
        "applications_by_category": {"TEACHING": 1},
        "talent_pool_final": 2,
        "talent_pool_nts": 1,
    }
    assert body["sheet_visible"] is True
    assert body["sheet_ignores_campus"] is True


def test_waitlisted_applications_are_split_by_category(client, db_session, published_vacancy_factory, application_factory):
    teaching = published_vacancy_factory(campus_code="SSE", slot_count=2)
    nts = published_vacancy_factory(campus_code="SSE", slot_count=2, role_category=StaffRoleCategoryEnum.NON_TEACHING)
    _app(application_factory, teaching, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, nts, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, nts, ApplicationStatusEnum.WAITLISTED)
    db_session.commit()

    body = _get(client, teaching.hr_admin)
    assert body["waitlisted"]["applications"] == 3
    assert body["waitlisted"]["applications_by_category"] == {"TEACHING": 1, "NON_TEACHING": 2}


# --- Sent to University -------------------------------------------------------


def test_sent_to_university_counts_members_of_pending_batches(client, db_session, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    actor = vacancy.hr_admin
    _batch(db_session, actor, BATCH_SENT_TO_UNIVERSITY, vacancy.campus, 2)
    _batch(db_session, actor, BATCH_SENT_TO_UNIVERSITY, None, 1)
    _batch(db_session, actor, BATCH_UNIVERSITY_APPROVED, vacancy.campus, 4)
    db_session.commit()

    body = _get(client, actor)
    assert body["sent_to_university"] == {"total": 3, "batches": 2, "members": 3}
    assert body["pipeline_extension"][0] == {"stage": "Sent to University", "count": 3}

    # Campus filter: the campus-less batch drops out.
    narrowed = _get(client, actor, campus_code="SSE")
    assert narrowed["sent_to_university"] == {"total": 2, "batches": 1, "members": 2}


# --- Provisional orders this month -----------------------------------------------


def test_provisional_orders_month_boundary(db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=5)
    actor = vacancy.hr_admin
    for day in (date(2026, 10, 1), date(2026, 10, 31)):
        _appointment(db_session, _app(application_factory, vacancy, ApplicationStatusEnum.JOINED), actor, day)
    # Outside the month on each side, and a cancelled order inside it.
    _appointment(db_session, _app(application_factory, vacancy, ApplicationStatusEnum.JOINED), actor, date(2026, 9, 30))
    _appointment(db_session, _app(application_factory, vacancy, ApplicationStatusEnum.JOINED), actor, date(2026, 11, 1))
    _appointment(
        db_session,
        _app(application_factory, vacancy, ApplicationStatusEnum.JOINED),
        actor,
        date(2026, 10, 15),
        status=APPOINTMENT_ORDER_CANCELLED,
    )
    _register(db_session, date(2026, 10, 1))
    _register(db_session, date(2026, 10, 31), campus_code="SCLAS")
    _register(db_session, date(2026, 10, 20), active=False)
    _register(db_session, date(2026, 9, 30))
    _register(db_session, date(2026, 11, 1))
    _register(db_session, None)
    db_session.flush()

    scope = CampusScope(is_global=True, campus_id=None)
    out = pipeline_extras.get_pipeline_extras(
        db_session, scope, role=UserRoleEnum.HR_ADMIN, month_of=date(2026, 10, 31)
    )
    assert out["month"] == "2026-10"
    assert out["provisional_orders_this_month"] == {"total": 4, "order_register": 2, "appointment_orders": 2}

    # Campus filter narrows the register by campus_code and orders by campus_id.
    out = pipeline_extras.get_pipeline_extras(
        db_session, scope, role=UserRoleEnum.HR_ADMIN, campus_code="SSE", month_of=date(2026, 10, 1)
    )
    assert out["provisional_orders_this_month"] == {"total": 3, "order_register": 1, "appointment_orders": 2}

    out = pipeline_extras.get_pipeline_extras(
        db_session, scope, role=UserRoleEnum.HR_ADMIN, month_of=date(2026, 11, 1)
    )
    assert out["provisional_orders_this_month"] == {"total": 2, "order_register": 1, "appointment_orders": 1}


def test_india_month_is_used_by_default():
    # 31 Oct 20:00 UTC is already 1 Nov in India.
    assert datetime(2026, 10, 31, 20, 0, tzinfo=timezone.utc).astimezone(pipeline_extras.IST).date() == date(2026, 11, 1)
    assert pipeline_extras._month_bounds(date(2026, 12, 15)) == (date(2026, 12, 1), date(2027, 1, 1))


# --- Awaiting HOD review / permanent order ---------------------------------------


def test_awaiting_hod_review_overdue_matches_provisional_orders_page(
    client, db_session, published_vacancy_factory, application_factory
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=4)
    actor = vacancy.hr_admin
    _app(application_factory, vacancy, ApplicationStatusEnum.HANDED_OVER_TO_HOD)
    _app(application_factory, vacancy, ApplicationStatusEnum.HOD_REVIEW_COMPLETE)
    _app(application_factory, vacancy, ApplicationStatusEnum.HOD_REVIEW_COMPLETE)
    today = date.today()
    _sheet_order(db_session, today - timedelta(days=1))  # overdue
    _sheet_order(db_session, today - timedelta(days=9))  # overdue
    _sheet_order(db_session, today - timedelta(days=3), outcome="PERMANENT_ORDER_RECEIVED")  # has outcome
    _sheet_order(db_session, today - timedelta(days=4), outcome_raw="Left")  # raw-only outcome
    marked = _sheet_order(db_session, today - timedelta(days=5))  # app mark gives an outcome
    _add(db_session, ProvisionalOrderMark(provisional_order_id=marked.id, outcome="PROBATION_EXTENDED", marked={}))
    _sheet_order(db_session, today)  # ends today: not overdue
    _sheet_order(db_session, today - timedelta(days=2), active=False)
    db_session.commit()

    body = _get(client, actor)
    page = client.get(
        "/api/v1/joining-records/orders/summary", headers=auth_headers(client, actor)
    ).json()
    assert page["probation_overdue"] == 2
    assert body["awaiting_hod_review"] == {"total": 3, "applications": 1, "sheet_overdue": 2}
    assert body["awaiting_hod_review"]["sheet_overdue"] == page["probation_overdue"]
    assert body["awaiting_permanent_order"] == {"total": 2, "applications": 2}


def test_pipeline_extension_appends_four_trailing_stages(client, db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=4)
    _app(application_factory, vacancy, ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED)
    _app(application_factory, vacancy, ApplicationStatusEnum.HOD_REVIEW_COMPLETE)
    _app(application_factory, vacancy, ApplicationStatusEnum.PERMANENT_ORDER_ISSUED)
    _app(application_factory, vacancy, ApplicationStatusEnum.PERMANENT_ORDER_ISSUED)
    db_session.commit()

    body = _get(client, vacancy.hr_admin)
    assert body["pipeline_extension"] == [
        {"stage": "Sent to University", "count": 0},
        {"stage": "Provisional order issued", "count": 1},
        {"stage": "HOD review complete", "count": 1},
        {"stage": "Permanent order issued", "count": 2},
    ]
    # The /kpis funnel is untouched: same stages, these still count as Joined.
    kpis = client.get("/api/v1/dashboard/kpis", headers=auth_headers(client, vacancy.hr_admin)).json()
    funnel = {r["stage"]: r["count"] for r in kpis["application_pipeline_funnel"]}
    assert list(funnel) == ["Applied", "Screening", "Interview", "Selected", "Offer", "Joined", "Rejected", "Waitlisted"]
    assert funnel["Joined"] == 4


# --- Campus scope and access --------------------------------------------------------


def test_campus_filter_narrows_applications_but_not_sheet_sources(
    client, db_session, published_vacancy_factory, application_factory
):
    sse = published_vacancy_factory(campus_code="SSE", slot_count=2)
    scad = published_vacancy_factory(campus_code="SCAD", slot_count=2)
    _app(application_factory, sse, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, scad, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, scad, ApplicationStatusEnum.HANDED_OVER_TO_HOD)
    _pool(db_session, TalentPoolSourceTabEnum.NTS, "Waiting List")
    _sheet_order(db_session, date.today() - timedelta(days=1))
    db_session.commit()

    everywhere = _get(client, sse.hr_admin)
    assert everywhere["waitlisted"]["applications"] == 2
    assert everywhere["awaiting_hod_review"]["applications"] == 1

    narrowed = _get(client, sse.hr_admin, campus_code="SSE")
    assert narrowed["waitlisted"] == {
        "total": 2,
        "applications": 1,
        "applications_by_category": {"TEACHING": 1},
        "talent_pool_final": 0,
        "talent_pool_nts": 1,
    }
    assert narrowed["awaiting_hod_review"] == {"total": 1, "applications": 0, "sheet_overdue": 1}


def test_non_sheet_reader_gets_app_counts_only(client, db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=2)
    other = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    _app(application_factory, vacancy, ApplicationStatusEnum.WAITLISTED)
    _app(application_factory, other, ApplicationStatusEnum.WAITLISTED)
    _pool(db_session, TalentPoolSourceTabEnum.NTS, "Waiting List")
    _batch(db_session, vacancy.hr_admin, BATCH_SENT_TO_UNIVERSITY, vacancy.campus, 2)
    _sheet_order(db_session, date.today() - timedelta(days=1))
    db_session.commit()

    # CAMPUS_HOD holds SETTINGS (dashboard gate) but not the sheet routers' roles,
    # and is single-campus: SSE only.
    body = _get(client, vacancy.hod)
    assert body["sheet_visible"] is False
    assert body["waitlisted"] == {
        "total": 1,
        "applications": 1,
        "applications_by_category": {"TEACHING": 1},
        "talent_pool_final": None,
        "talent_pool_nts": None,
    }
    assert body["sent_to_university"] == {"total": 0, "batches": None, "members": None}
    assert body["provisional_orders_this_month"]["order_register"] is None
    assert body["awaiting_hod_review"]["sheet_overdue"] is None
    assert [r["stage"] for r in body["pipeline_extension"]] == [
        "Provisional order issued",
        "HOD review complete",
        "Permanent order issued",
    ]


def test_coordinator_can_read_sheet_parts(client, db_session, user_factory, campus_factory):
    campus_factory("SSE")
    coordinator = user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR, campus_code="SSE")
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Waiting List")
    db_session.commit()
    body = _get(client, coordinator)
    assert body["sheet_visible"] is True
    assert body["waitlisted"]["talent_pool_final"] == 1


# --- Talent Pool outcomes + waiting preview ---------------------------------------


def test_talent_pool_outcomes_per_tab_not_summed(client, db_session, user_factory, campus_factory):
    campus_factory("SSE")
    admin = user_factory(UserRoleEnum.HR_ADMIN, campus_code="SSE")
    T, N = TalentPoolSourceTabEnum.TEACHING_FINAL, TalentPoolSourceTabEnum.NTS
    for _ in range(3):
        _pool(db_session, T, "Selected")
    _pool(db_session, T, "Selected", active=False)
    _pool(db_session, T, "Joined")
    _pool(db_session, T, "Waiting List")
    _pool(db_session, T, "Rejected")
    _pool(db_session, T, "Something else")
    _pool(db_session, N, "Selected")
    _pool(db_session, N, "Waiting List")
    _pool(db_session, N, "Waiting List")
    _pool(db_session, N, "Rejected", active=False)
    db_session.commit()

    body = _get(client, admin)
    assert body["talent_pool_outcomes"] == {
        "teaching": {"selected": 3, "joined": 1, "waiting_list": 1, "rejected": 1, "total": 7},
        "non_teaching": {"selected": 1, "joined": 0, "waiting_list": 2, "rejected": 0, "total": 3},
    }


def test_talent_pool_extras_none_for_non_sheet_reader(client, db_session, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _pool(db_session, TalentPoolSourceTabEnum.NTS, "Waiting List")
    db_session.commit()
    body = _get(client, vacancy.hod)
    assert body["sheet_visible"] is False
    assert body["talent_pool_outcomes"] is None
    assert body["talent_pool_waiting_preview"] is None


def test_waiting_preview_orders_by_row_number_and_caps_at_three(client, db_session, user_factory, campus_factory):
    campus_factory("SSE")
    admin = user_factory(UserRoleEnum.HR_ADMIN, campus_code="SSE")
    T, N = TalentPoolSourceTabEnum.TEACHING_FINAL, TalentPoolSourceTabEnum.NTS
    for number in (9, 4, None, 7, 2):
        entry = _pool(db_session, T, "Waiting List")
        entry.sheet_row_number = number
        entry.full_name = f"T{number}"
        entry.dept_raw = "CSE"
    skipped = _pool(db_session, T, "Waiting List", active=False)
    skipped.sheet_row_number = 1
    other_status = _pool(db_session, T, "Selected")
    other_status.sheet_row_number = 1
    nts = _pool(db_session, N, "Waiting List")
    nts.sheet_row_number = 5
    nts.full_name = "N5"
    nts.applied_post = "Clerk"
    db_session.commit()

    preview = _get(client, admin)["talent_pool_waiting_preview"]
    assert [r["full_name"] for r in preview["teaching"]] == ["T2", "T4", "T7"]
    assert preview["teaching"][0]["dept_raw"] == "CSE"
    assert preview["teaching"][0]["applied_post"] is None
    assert [r["full_name"] for r in preview["non_teaching"]] == ["N5"]
    assert preview["non_teaching"][0]["applied_post"] == "Clerk"
    assert set(preview["teaching"][0]) == {"id", "full_name", "dept_raw", "applied_post"}


def test_campus_code_does_not_change_talent_pool_extras(client, db_session, user_factory, campus_factory):
    campus_factory("SSE")
    admin = user_factory(UserRoleEnum.HR_ADMIN, campus_code="SSE")
    _pool(db_session, TalentPoolSourceTabEnum.TEACHING_FINAL, "Waiting List")
    _pool(db_session, TalentPoolSourceTabEnum.NTS, "Joined")
    db_session.commit()
    everywhere = _get(client, admin)
    narrowed = _get(client, admin, campus_code="SSE")
    assert narrowed["talent_pool_outcomes"] == everywhere["talent_pool_outcomes"]
    assert narrowed["talent_pool_outcomes"]["teaching"]["waiting_list"] == 1
    assert narrowed["talent_pool_waiting_preview"] == everywhere["talent_pool_waiting_preview"]
