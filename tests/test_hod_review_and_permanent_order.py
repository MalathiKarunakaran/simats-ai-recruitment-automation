"""HOD review + permanent order for in-app hires
(docs/specs/hod-review-and-permanent-order.md)."""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.audit_log import AuditLog
from app.models.candidate import Candidate
from app.models.enums import (
    APPLICATION_TERMINAL_STATUSES,
    ApplicationStatusEnum,
    HiringSlotStatusEnum,
    HodRecommendationEnum,
    UserRoleEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.hod_review import HodReview
from app.models.permanent_order import PermanentOrder
from app.services import appointment_orders, candidates as candidates_service, hod_reviews, permanent_orders, pipeline
from app.services.sanctioned_strength import working_count_for
from app.services.tracker_import import VALID_APPLICATION_STATUSES
from app.services.tracker_template import STATUSES as TEMPLATE_STATUSES
from tests.conftest import auth_headers

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
TODAY = datetime.now(timezone.utc).date()


@pytest.fixture()
def handed_over(published_vacancy_factory, hired_employee_factory):
    """An application at HANDED_OVER_TO_HOD, with its provisional order."""

    def _make(vacancy=None, **vacancy_kwargs):
        vacancy = vacancy or published_vacancy_factory(slot_count=3, **vacancy_kwargs)
        hire = hired_employee_factory(vacancy)
        return vacancy, hire.application

    return _make


def _review(client, headers, application, *, file=None, **fields):
    data = {
        "hod_name": "Dr. Test HOD",
        "review_date": TODAY.isoformat(),
        "recommendation": "RECOMMEND_PERMANENT",
        **fields,
    }
    files = {"file": file} if file else None
    return client.post(f"/api/v1/applications/{application.id}/hod-reviews", headers=headers, data=data, files=files)


def _order(client, headers, application, **fields):
    body = {
        "registrar_ref_no": "SIMATS/REG/PO/2026/041",
        "order_date": TODAY.isoformat(),
        "issued_to_faculty_on": TODAY.isoformat(),
        **fields,
    }
    return client.post(f"/api/v1/applications/{application.id}/permanent-order", headers=headers, json=body)


def _record(db_session, vacancy, application, recommendation, **kwargs):
    return hod_reviews.record_review(
        db_session,
        application=application,
        actor=vacancy.hr_admin,
        hod_name="Dr. Test HOD",
        review_date=kwargs.pop("review_date", TODAY),
        recommendation=recommendation,
        **kwargs,
    )


# ---------------------------------------------------------------- statuses


def test_handed_over_is_no_longer_terminal_and_the_permanent_order_is():
    assert ApplicationStatusEnum.HANDED_OVER_TO_HOD not in APPLICATION_TERMINAL_STATUSES
    assert ApplicationStatusEnum.HOD_REVIEW_COMPLETE not in APPLICATION_TERMINAL_STATUSES
    assert ApplicationStatusEnum.PERMANENT_ORDER_ISSUED in APPLICATION_TERMINAL_STATUSES


def test_tracker_import_and_template_refuse_the_new_statuses():
    for value in ("HOD_REVIEW_COMPLETE", "PERMANENT_ORDER_ISSUED"):
        assert value not in VALID_APPLICATION_STATUSES
        assert value not in TEMPLATE_STATUSES
    assert "HANDED_OVER_TO_HOD" in VALID_APPLICATION_STATUSES


# ------------------------------------------------------------- transitions


def test_only_recommend_advances(client, db_session, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)

    extend = _review(
        client, headers, application, recommendation="EXTEND_PROBATION",
        new_probation_end_date=(TODAY + timedelta(days=90)).isoformat(),
    )
    assert extend.status_code == 201, extend.text
    not_recommended = _review(client, headers, application, recommendation="NOT_RECOMMENDED", remarks="Needs time")
    assert not_recommended.status_code == 201, not_recommended.text
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.HANDED_OVER_TO_HOD

    recommend = _review(client, headers, application)
    assert recommend.status_code == 201, recommend.text
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.HOD_REVIEW_COMPLETE

    # Every review is kept, latest first.
    history = client.get(f"/api/v1/applications/{application.id}/hod-reviews", headers=headers).json()
    assert len(history["items"]) == 3
    assert history["items"][0]["recommendation"] == "RECOMMEND_PERMANENT"
    assert history["hod_assigned"] == vacancy.hod.full_name

    # No more reviews once complete.
    assert _review(client, headers, application).status_code == 409


def test_extend_requires_a_date_and_moves_the_probation_end(client, db_session, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    order = appointment_orders.current_order(db_session, application)

    missing = _review(client, headers, application, recommendation="EXTEND_PROBATION")
    assert missing.status_code == 422
    assert "new probation end date" in missing.json()["detail"]
    stray = _review(
        client, headers, application, recommendation="NOT_RECOMMENDED", new_probation_end_date=TODAY.isoformat()
    )
    assert stray.status_code == 422
    assert db_session.query(HodReview).count() == 0

    history = client.get(f"/api/v1/applications/{application.id}/hod-reviews", headers=headers).json()
    assert history["probation_end_date"] == order.probation_end_date.isoformat()

    new_end = order.probation_end_date + timedelta(days=60)
    assert _review(
        client, headers, application, recommendation="EXTEND_PROBATION", new_probation_end_date=new_end.isoformat()
    ).status_code == 201
    history = client.get(f"/api/v1/applications/{application.id}/hod-reviews", headers=headers).json()
    assert history["probation_end_date"] == new_end.isoformat()
    assert history["provisional_probation_end_date"] == order.probation_end_date.isoformat()
    # The provisional order shows the extension-aware end too.
    shown = client.get(f"/api/v1/applications/{application.id}/provisional-order", headers=headers).json()
    assert shown["current_probation_end_date"] == new_end.isoformat()
    assert shown["probation_end_date"] == order.probation_end_date.isoformat()
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.HANDED_OVER_TO_HOD


def test_review_only_at_handed_over(client, db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory()
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    response = _review(client, auth_headers(client, vacancy.hr_admin), application)
    assert response.status_code == 409
    assert "HANDED_OVER_TO_HOD" in response.json()["detail"]


def test_permanent_order_only_from_hod_review_complete(client, db_session, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    refused = _order(client, headers, application)
    assert refused.status_code == 409
    assert "HOD_REVIEW_COMPLETE" in refused.json()["detail"]
    assert db_session.query(PermanentOrder).count() == 0

    assert _review(client, headers, application).status_code == 201
    ok = _order(client, headers, application)
    assert ok.status_code == 201, ok.text
    assert ok.json()["registrar_ref_no"] == "SIMATS/REG/PO/2026/041"
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.PERMANENT_ORDER_ISSUED
    assert client.get(f"/api/v1/applications/{application.id}/permanent-order", headers=headers).status_code == 200

    # Terminal now: nothing more, not even a second order.
    assert _order(client, headers, application).status_code == 409
    with pytest.raises(HTTPException) as exc:
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.REJECTED,
            actor=vacancy.hr_admin, reason="x",
        )
    assert exc.value.status_code == 409


def test_permanent_order_dates_are_checked(client, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    _review(client, headers, application)
    response = _order(client, headers, application, issued_to_faculty_on=(TODAY - timedelta(days=1)).isoformat())
    assert response.status_code == 422
    assert _order(client, headers, application, registrar_ref_no="").status_code == 422


def test_nothing_skips_the_hod_review(db_session, handed_over):
    vacancy, application = handed_over()
    # Even with a permanent order row somehow present, the status needs the review.
    db_session.add(
        PermanentOrder(
            application_id=application.id, campus_id=application.campus_id, registrar_ref_no="X",
            order_date=TODAY, issued_to_faculty_on=TODAY, recorded_by_id=vacancy.hr_admin.id,
            recorded_at=datetime.now(timezone.utc),
        )
    )
    db_session.flush()
    for target, needle in (
        (ApplicationStatusEnum.PERMANENT_ORDER_ISSUED, "HOD review"),
        (ApplicationStatusEnum.HOD_REVIEW_COMPLETE, "Recommend for permanent"),
    ):
        with pytest.raises(HTTPException) as exc:
            pipeline.transition_application_status(
                db_session, application=application, new_status=target, actor=vacancy.hr_admin
            )
        assert exc.value.status_code == 409
        assert needle in exc.value.detail

    # A not-recommended review does not open the gate either.
    _record(db_session, vacancy, application, HodRecommendationEnum.NOT_RECOMMENDED)
    with pytest.raises(HTTPException):
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.HOD_REVIEW_COMPLETE,
            actor=vacancy.hr_admin,
        )
    assert application.status == ApplicationStatusEnum.HANDED_OVER_TO_HOD


def test_an_earlier_stage_cannot_jump_to_the_new_ones(db_session, handed_over):
    vacancy, application = handed_over()
    application.status = ApplicationStatusEnum.ORIENTATION_COMPLETE
    db_session.flush()
    for target in (ApplicationStatusEnum.HOD_REVIEW_COMPLETE, ApplicationStatusEnum.PERMANENT_ORDER_ISSUED):
        with pytest.raises(HTTPException) as exc:
            pipeline.transition_application_status(
                db_session, application=application, new_status=target, actor=vacancy.hr_admin
            )
        assert exc.value.status_code == 409


def test_permanent_order_status_needs_the_order_row(db_session, handed_over):
    vacancy, application = handed_over()
    _record(db_session, vacancy, application, HodRecommendationEnum.RECOMMEND_PERMANENT)
    assert application.status == ApplicationStatusEnum.HOD_REVIEW_COMPLETE
    with pytest.raises(HTTPException) as exc:
        pipeline.transition_application_status(
            db_session, application=application, new_status=ApplicationStatusEnum.PERMANENT_ORDER_ISSUED,
            actor=vacancy.hr_admin,
        )
    assert exc.value.status_code == 409
    assert "permanent order" in exc.value.detail


def test_generic_status_endpoint_cannot_move_past_handover(client, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"/api/v1/applications/{application.id}/status"
    assert client.patch(url, headers=headers, json={"status": "HOD_REVIEW_COMPLETE"}).status_code == 409
    assert client.patch(url, headers=headers, json={"status": "PERMANENT_ORDER_ISSUED"}).status_code == 409


def test_handed_over_cannot_be_rejected_or_withdrawn(client, db_session, handed_over):
    """These stages were terminal until now; leaving stays the offboarding action."""
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    url = f"/api/v1/applications/{application.id}/status"
    for target in ("REJECTED", "WITHDRAWN"):
        response = client.patch(url, headers=headers, json={"status": target, "reason": "x"})
        assert response.status_code == 409
        assert "offboarding" in response.json()["detail"]
    _record(db_session, vacancy, application, HodRecommendationEnum.RECOMMEND_PERMANENT)
    db_session.flush()
    assert client.patch(url, headers=headers, json={"status": "REJECTED", "reason": "x"}).status_code == 409

    # Withdrawing the candidate leaves the hired application alone.
    candidate = db_session.get(Candidate, application.candidate_id)
    candidates_service.withdraw_candidate(db_session, candidate=candidate, reason="Left", actor=vacancy.hr_admin)
    assert application.status == ApplicationStatusEnum.HOD_REVIEW_COMPLETE


def test_existing_handed_over_rows_are_untouched(db_session, handed_over):
    """A hire handed over before this change keeps its status, its slot and
    its employee; nothing is rewritten until someone records a review."""
    vacancy, application = handed_over()
    assert application.status == ApplicationStatusEnum.HANDED_OVER_TO_HOD
    assert db_session.query(HodReview).count() == 0
    slot = db_session.query(HiringSlot).filter(HiringSlot.reserved_application_id == application.id).one()
    assert slot.status == HiringSlotStatusEnum.FILLED


# -------------------------------------------------- slots and working count


def test_new_stages_leave_slots_and_working_count_alone(
    client, db_session, published_vacancy_factory, hired_employee_factory, designation_factory
):
    vacancy = published_vacancy_factory(slot_count=2)
    designation = designation_factory(department=vacancy.department, name="Assistant Professor")
    vacancy.vacancy_request.designation_id = designation.id
    db_session.flush()
    application = hired_employee_factory(vacancy).application

    def snapshot():
        slots = db_session.query(HiringSlot).filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id)
        return (
            sorted((s.slot_number, s.status.value, s.reserved_application_id) for s in slots),
            working_count_for(db_session, department_id=vacancy.department.id, designation_id=designation.id),
            vacancy.vacancy_request.status,
        )

    before = snapshot()
    assert before[1] == 1
    headers = auth_headers(client, vacancy.hr_admin)
    assert _review(client, headers, application).status_code == 201
    assert _order(client, headers, application).status_code == 201
    db_session.expire_all()
    assert snapshot() == before


# ------------------------------------------------------------------- files


def test_review_file_upload_and_download(client, db_session, handed_over, fake_minio_client):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    response = _review(
        client, headers, application, recommendation="NOT_RECOMMENDED", file=("review.png", PNG_BYTES, "image/png")
    )
    assert response.status_code == 201, response.text
    assert response.json()["file_content_type"] == "image/png"
    assert response.json()["file_size"] == len(PNG_BYTES)
    review_id = response.json()["id"]

    download = client.get(f"/api/v1/applications/{application.id}/hod-reviews/{review_id}/file", headers=headers)
    assert download.status_code == 200
    assert download.content == PNG_BYTES

    plain = _review(client, headers, application, recommendation="NOT_RECOMMENDED")
    assert client.get(
        f"/api/v1/applications/{application.id}/hod-reviews/{plain.json()['id']}/file", headers=headers
    ).status_code == 404


@pytest.mark.parametrize(
    "data,content_type,detail",
    [
        (b"hello", "text/plain", "Only PDF, JPEG or PNG"),
        (PNG_BYTES, "application/pdf", "does not match"),
        (b"%PDF" + b"\x00" * (10 * 1024 * 1024), "application/pdf", "10 MB"),
    ],
)
def test_review_file_validation_writes_nothing(client, db_session, handed_over, data, content_type, detail):
    vacancy, application = handed_over()
    response = _review(
        client, auth_headers(client, vacancy.hr_admin), application, file=("f", data, content_type)
    )
    assert response.status_code == 400
    assert detail in response.json()["detail"]
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.HANDED_OVER_TO_HOD
    assert db_session.query(HodReview).count() == 0


def test_storage_down_is_502(client, db_session, handed_over, fake_minio_client):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    fake_minio_client.fail_puts = True
    assert _review(client, headers, application, file=("r.png", PNG_BYTES, "image/png")).status_code == 502
    assert db_session.query(HodReview).count() == 0

    fake_minio_client.fail_puts = False
    _review(client, headers, application)
    _order(client, headers, application)
    fake_minio_client.fail_puts = True
    upload = client.post(
        f"/api/v1/applications/{application.id}/permanent-order/file",
        headers=headers,
        files={"file": ("o.png", PNG_BYTES, "image/png")},
    )
    assert upload.status_code == 502


def test_permanent_order_file_upload_and_download(client, handed_over, fake_minio_client):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hr_admin)
    base = f"/api/v1/applications/{application.id}/permanent-order"
    _review(client, headers, application)
    assert client.post(f"{base}/file", headers=headers, files={"file": ("o.png", PNG_BYTES, "image/png")}).status_code == 404
    _order(client, headers, application)
    assert client.get(f"{base}/file", headers=headers).status_code == 404

    upload = client.post(f"{base}/file", headers=headers, files={"file": ("o.png", PNG_BYTES, "image/png")})
    assert upload.status_code == 200, upload.text
    assert upload.json()["file_content_type"] == "image/png"
    assert client.get(f"{base}/file", headers=headers).content == PNG_BYTES
    bad = client.post(f"{base}/file", headers=headers, files={"file": ("o.txt", b"hello", "text/plain")})
    assert bad.status_code == 400


# ------------------------------------------------------------------- roles


def test_hod_records_a_review_for_their_own_campus_only(client, db_session, handed_over, user_factory):
    vacancy, application = handed_over()
    own_hod = auth_headers(client, vacancy.hod)
    other_hod = auth_headers(client, user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD"))
    base = f"/api/v1/applications/{application.id}"

    assert _review(client, other_hod, application).status_code == 404
    assert client.get(f"{base}/hod-reviews", headers=other_hod).status_code == 404

    assert client.get(f"{base}/hod-reviews", headers=own_hod).status_code == 200
    response = _review(client, own_hod, application)
    assert response.status_code == 201, response.text
    assert response.json()["recorded_by_id"] == str(vacancy.hod.id)

    # The permanent order is the office's job, not the HOD's.
    assert _order(client, own_hod, application).status_code == 403
    assert client.get(f"{base}/permanent-order", headers=own_hod).status_code == 403


def test_review_and_order_roles(client, db_session, handed_over, user_factory):
    vacancy, application = handed_over()
    coordinator = auth_headers(client, user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR))
    super_admin = auth_headers(client, user_factory(UserRoleEnum.SUPER_ADMIN))
    officer = auth_headers(client, vacancy.recruitment_officer)
    panel = auth_headers(client, user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE"))
    management = auth_headers(client, user_factory(UserRoleEnum.MANAGEMENT))
    base = f"/api/v1/applications/{application.id}"

    for headers in (officer, panel, management):
        assert _review(client, headers, application).status_code == 403
    # The officer holds ONBOARDING, so can read what was recorded.
    assert client.get(f"{base}/hod-reviews", headers=officer).status_code == 200
    assert client.get(f"{base}/hod-reviews", headers=panel).status_code == 403

    assert _review(client, coordinator, application, recommendation="NOT_RECOMMENDED").status_code == 201
    assert _review(client, super_admin, application).status_code == 201
    assert _order(client, officer, application).status_code == 403
    assert _order(client, coordinator, application).status_code == 201


# ------------------------------------------------------------------- audit


def test_audit_rows_carry_the_actor(client, db_session, handed_over):
    vacancy, application = handed_over()
    headers = auth_headers(client, vacancy.hod)
    review_id = _review(client, headers, application, remarks="Good teacher").json()["id"]
    review_audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "HodReview", AuditLog.action == "CREATE")
        .one()
    )
    assert str(review_audit.entity_id) == review_id
    assert review_audit.actor_user_id == vacancy.hod.id
    assert review_audit.after_state["recommendation"] == "RECOMMEND_PERMANENT"
    assert review_audit.after_state["remarks"] == "Good teacher"

    # Rows in one test transaction share now(), so match on the status.
    transition = next(
        row
        for row in db_session.query(AuditLog).filter(
            AuditLog.action == "APPLICATION_STATUS_TRANSITION", AuditLog.entity_id == application.id
        )
        if row.after_state["status"] == "HOD_REVIEW_COMPLETE"
    )
    assert transition.before_state["status"] == "HANDED_OVER_TO_HOD"
    assert transition.actor_user_id == vacancy.hod.id

    _order(client, auth_headers(client, vacancy.hr_admin), application)
    order_audit = db_session.query(AuditLog).filter(AuditLog.entity_type == "PermanentOrder").one()
    assert order_audit.actor_user_id == vacancy.hr_admin.id
    assert order_audit.after_state["registrar_ref_no"] == "SIMATS/REG/PO/2026/041"
    statuses = [
        row.after_state["status"]
        for row in db_session.query(AuditLog).filter(
            AuditLog.action == "APPLICATION_STATUS_TRANSITION", AuditLog.entity_id == application.id
        )
    ]
    assert "PERMANENT_ORDER_ISSUED" in statuses


# ---------------------------------------------------------- onboarding list


def test_onboarding_probation_rows(client, db_session, published_vacancy_factory, hired_employee_factory, user_factory):
    vacancy = published_vacancy_factory(slot_count=4)
    joined_on = TODAY - timedelta(days=120)
    overdue = hired_employee_factory(vacancy, joining_date=joined_on).application
    recommended = hired_employee_factory(vacancy, joining_date=joined_on).application
    extended = hired_employee_factory(vacancy, joining_date=joined_on).application
    fresh = hired_employee_factory(vacancy).application
    for app_ in (overdue, recommended, extended):
        order = appointment_orders.current_order(db_session, app_)
        order.probation_end_date = TODAY - timedelta(days=5)
    db_session.flush()
    _record(db_session, vacancy, overdue, HodRecommendationEnum.NOT_RECOMMENDED)
    _record(db_session, vacancy, recommended, HodRecommendationEnum.RECOMMEND_PERMANENT)
    _record(
        db_session, vacancy, extended, HodRecommendationEnum.EXTEND_PROBATION,
        new_probation_end_date=TODAY + timedelta(days=30),
    )
    db_session.flush()

    response = client.get("/api/v1/onboarding/probation", headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 200, response.text
    rows = {row["application_id"]: row for row in response.json()}

    row = rows[str(overdue.id)]
    assert row["status"] == "HANDED_OVER_TO_HOD"
    assert row["days_since_joining"] == 120
    assert row["joining_date"] == joined_on.isoformat()
    assert row["probation_end_date"] == (TODAY - timedelta(days=5)).isoformat()
    assert row["latest_recommendation"] == "NOT_RECOMMENDED"
    assert row["past_probation_without_recommendation"] is True

    assert rows[str(recommended.id)]["status"] == "HOD_REVIEW_COMPLETE"
    assert rows[str(recommended.id)]["past_probation_without_recommendation"] is False
    assert rows[str(extended.id)]["probation_end_date"] == (TODAY + timedelta(days=30)).isoformat()
    assert rows[str(extended.id)]["past_probation_without_recommendation"] is False
    assert rows[str(fresh.id)]["days_since_joining"] == 0
    assert rows[str(fresh.id)]["past_probation_without_recommendation"] is False

    # Campus-scoped: an HOD elsewhere sees none of these; the own HOD sees them.
    other_hod = auth_headers(client, user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SCAD"))
    assert client.get("/api/v1/onboarding/probation", headers=other_hod).json() == []
    own = client.get("/api/v1/onboarding/probation", headers=auth_headers(client, vacancy.hod)).json()
    assert {r["application_id"] for r in own} >= {str(overdue.id), str(fresh.id)}
    panel = auth_headers(client, user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE"))
    assert client.get("/api/v1/onboarding/probation", headers=panel).status_code == 403


def test_reporting_counts_the_new_stages_as_joined(db_session, handed_over):
    from app.services.reporting import _FUNNEL_BUCKET_BY_STATUS, _JOINED_OR_LATER_STATUSES

    for value in (ApplicationStatusEnum.HOD_REVIEW_COMPLETE, ApplicationStatusEnum.PERMANENT_ORDER_ISSUED):
        assert _FUNNEL_BUCKET_BY_STATUS[value] == "Joined"
        assert value in _JOINED_OR_LATER_STATUSES


def test_permanent_orders_service_refuses_twice(db_session, handed_over):
    vacancy, application = handed_over()
    _record(db_session, vacancy, application, HodRecommendationEnum.RECOMMEND_PERMANENT)
    permanent_orders.record_order(
        db_session, application=application, actor=vacancy.hr_admin, registrar_ref_no="R1",
        order_date=date(2026, 10, 1), issued_to_faculty_on=date(2026, 10, 2),
    )
    with pytest.raises(HTTPException) as exc:
        permanent_orders.record_order(
            db_session, application=application, actor=vacancy.hr_admin, registrar_ref_no="R2",
            order_date=date(2026, 10, 1), issued_to_faculty_on=date(2026, 10, 2),
        )
    assert exc.value.status_code == 409
