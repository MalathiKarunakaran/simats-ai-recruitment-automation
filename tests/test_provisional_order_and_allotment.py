"""Provisional appointment order + department allotment
(docs/specs/provisional-order-and-allotment.md)."""

import io
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy.exc import IntegrityError

from app.models.appointment_order import AppointmentOrder
from app.models.audit_log import AuditLog
from app.models.enums import (
    ApplicationStatusEnum,
    JoiningDocumentStatusEnum,
    OfferStatusEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.joining import JoiningDocument
from app.models.offer import Offer
from app.models.resume_score import ResumeScore
from app.models.sanctioned_strength import SanctionedStrength
from app.services import appointment_orders, pipeline
from app.services import joining as joining_service
from app.services.department_allotment import department_options
from tests.conftest import auth_headers

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _to_joined(db_session, vacancy, application):
    actor = vacancy.hr_admin
    for target in (
        ApplicationStatusEnum.SCREENING,
        ApplicationStatusEnum.CALLED_FOR_INTERVIEW,
        ApplicationStatusEnum.INTERVIEWED,
        ApplicationStatusEnum.SELECTED,
    ):
        pipeline.transition_application_status(db_session, application=application, new_status=target, actor=actor)
    offer = Offer(application_id=application.id, offered_by_id=actor.id, salary_amount=50000, joining_date=date(2026, 11, 2))
    db_session.add(offer)
    db_session.flush()
    offer.status = OfferStatusEnum.ACCEPTED
    for target in (
        ApplicationStatusEnum.OFFER_SENT,
        ApplicationStatusEnum.OFFER_ACCEPTED,
        ApplicationStatusEnum.JOINING_CONFIRMED,
    ):
        pipeline.advance_if_behind(db_session, application=application, target_status=target, actor=actor)
    joining_service.initialize_joining_checklist(
        db_session, application=application, joining_date=date(2026, 11, 2), actor=actor
    )
    db_session.flush()
    for doc in db_session.query(JoiningDocument).filter(JoiningDocument.application_id == application.id):
        doc.status = JoiningDocumentStatusEnum.RECEIVED
    pipeline.transition_application_status(
        db_session, application=application, new_status=ApplicationStatusEnum.JOINED, actor=actor
    )
    db_session.flush()
    return application


@pytest.fixture()
def joined(db_session, published_vacancy_factory, application_factory):
    def _make(vacancy=None, **vacancy_kwargs):
        vacancy = vacancy or published_vacancy_factory(slot_count=3, **vacancy_kwargs)
        application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
        return vacancy, _to_joined(db_session, vacancy, application)

    return _make


def _issue(client, headers, application, **body):
    return client.post(f"/api/v1/applications/{application.id}/provisional-order", headers=headers, json=body or None)


# --------------------------------------------------------------- transitions


def test_cannot_skip_the_order_step(db_session, joined):
    vacancy, application = joined()
    for target in (
        ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED,
        ApplicationStatusEnum.ORIENTATION_COMPLETE,
        ApplicationStatusEnum.HANDED_OVER_TO_HOD,
    ):
        with pytest.raises(HTTPException) as exc:
            pipeline.transition_application_status(
                db_session, application=application, new_status=target, actor=vacancy.hr_admin
            )
        assert exc.value.status_code == 409
        assert "provisional order" in exc.value.detail


def test_order_status_needs_an_issued_order(db_session, joined):
    vacancy, application = joined()
    with pytest.raises(HTTPException) as exc:
        pipeline.transition_application_status(
            db_session,
            application=application,
            new_status=ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED,
            actor=vacancy.hr_admin,
        )
    assert exc.value.status_code == 409
    assert application.status == ApplicationStatusEnum.JOINED


def test_order_status_only_from_joined(db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    with pytest.raises(HTTPException) as exc:
        pipeline.transition_application_status(
            db_session,
            application=application,
            new_status=ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED,
            actor=vacancy.hr_admin,
        )
    assert exc.value.status_code == 409


def test_existing_rows_past_joined_are_untouched(db_session, joined):
    """An application allotted before the step existed keeps moving."""
    vacancy, application = joined()
    application.status = ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED  # as stored before this change
    db_session.flush()
    pipeline.transition_application_status(
        db_session, application=application, new_status=ApplicationStatusEnum.ORIENTATION_COMPLETE, actor=vacancy.hr_admin
    )
    assert application.status == ApplicationStatusEnum.ORIENTATION_COMPLETE


def test_allot_endpoint_refuses_at_joined(client, joined, allotment_seat_factory):
    vacancy, application = joined()
    allotment_seat_factory(vacancy)
    response = client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"department_id": str(vacancy.department.id)},
    )
    assert response.status_code == 409
    assert "PROVISIONAL_ORDER_ISSUED" in response.json()["detail"]


# ------------------------------------------------------------------- orders


def test_issue_order_numbers_continue_the_paper_register(client, db_session, joined):
    vacancy, first = joined()
    _, second = joined(vacancy)
    headers = auth_headers(client, vacancy.hr_admin)

    response = _issue(client, headers, first, order_date="2026-10-31")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["order_number"] == "SSE / PA/ 231/ 10/ 2026"
    assert body["sequence"] == 231
    assert body["order_date"] == "2026-10-31"
    assert body["probation_end_date"] == "2027-01-31"
    assert body["college_name"] == "SIMATS Engineering"
    assert body["principal_name"] == "Dr. B. Ramesh"
    assert body["category"] == "TEACHING"
    assert body["joining_date"] is not None
    db_session.refresh(first)
    assert first.status == ApplicationStatusEnum.PROVISIONAL_ORDER_ISSUED

    # Does not restart in a new year: next is 232.
    nxt = _issue(client, headers, second, order_date="2027-01-05").json()
    assert nxt["order_number"] == "SSE / PA/ 232/ 01/ 2027"

    audit = db_session.query(AuditLog).filter(AuditLog.entity_type == "AppointmentOrder").all()
    assert len(audit) == 2 and all(row.actor_user_id == vacancy.hr_admin.id for row in audit)


def test_each_campus_has_its_own_running_number(client, joined):
    vacancy, application = joined(campus_code="SCAD")
    response = _issue(client, auth_headers(client, vacancy.hr_admin), application, order_date="2026-11-03")
    assert response.json()["order_number"] == "SCAD / PA/ 023/ 11/ 2026"


def test_issue_twice_is_refused(client, joined):
    vacancy, application = joined()
    headers = auth_headers(client, vacancy.hr_admin)
    assert _issue(client, headers, application).status_code == 201
    assert _issue(client, headers, application).status_code == 409


def test_issue_only_at_joined(client, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    response = _issue(client, auth_headers(client, vacancy.hr_admin), application)
    assert response.status_code == 409


def test_campus_without_letter_details_is_refused(client, db_session, joined):
    vacancy, application = joined(campus_code="SHIFT")
    response = _issue(client, auth_headers(client, vacancy.hr_admin), application)
    assert response.status_code == 409
    assert response.json()["detail"] == "No letter details for campus SHIFT"
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.JOINED
    assert db_session.query(AppointmentOrder).count() == 0


def test_campus_sequence_is_unique(db_session, joined):
    vacancy, application = joined()
    order = appointment_orders.issue_provisional_order(db_session, application=application, actor=vacancy.hr_admin)
    duplicate = AppointmentOrder(
        application_id=application.id,
        campus_id=order.campus_id,
        sequence=order.sequence,
        order_number="something else",
        order_date=order.order_date,
        status="CANCELLED",
        issued_by_id=vacancy.hr_admin.id,
        issued_at=datetime.now(timezone.utc),
        candidate_name="x", designation="x", category="TEACHING", campus_code="SSE",
        college_name="x", principal_name="x", department_name="x", probation_end_date=order.order_date,
    )
    nested = db_session.begin_nested()
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.flush()
    nested.rollback()


def test_letter_pdf_carries_the_fields(client, joined):
    vacancy, application = joined()
    headers = auth_headers(client, vacancy.hr_admin)
    order = _issue(client, headers, application, order_date="2026-10-31").json()

    response = client.get(f"/api/v1/applications/{application.id}/provisional-order/letter.pdf", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages)
    text = " ".join(text.split())
    for expected in (
        f"Ref.No. {order['order_number']}",
        "31-10-2026",
        application.candidate.full_name,
        "Provisional Appointment Order",
        order["designation"],
        vacancy.department.name,
        "SIMATS Engineering",
        "Dr. B. Ramesh",
        "Dr. K. Malathi",
        "Associate Dean of Recruitment",
        "probation for a period of three months",
    ):
        assert expected in text, expected
    assert "DRAFT" not in text


def test_letter_before_order_is_404(client, joined):
    vacancy, application = joined()
    response = client.get(
        f"/api/v1/applications/{application.id}/provisional-order/letter.pdf",
        headers=auth_headers(client, vacancy.hr_admin),
    )
    assert response.status_code == 404


# -------------------------------------------------------------- signed copy


def _upload(client, headers, application, data, content_type, name="signed.pdf"):
    return client.post(
        f"/api/v1/applications/{application.id}/provisional-order/signed-copy",
        headers=headers,
        files={"file": (name, data, content_type)},
    )


def test_signed_copy_upload_and_download(client, joined, fake_minio_client):
    vacancy, application = joined()
    headers = auth_headers(client, vacancy.hr_admin)
    assert client.get(
        f"/api/v1/applications/{application.id}/provisional-order/signed-copy", headers=headers
    ).status_code == 404  # no order yet
    _issue(client, headers, application)
    assert client.get(
        f"/api/v1/applications/{application.id}/provisional-order/signed-copy", headers=headers
    ).status_code == 404  # no copy yet

    response = _upload(client, headers, application, PNG_BYTES, "image/png", name="signed.png")
    assert response.status_code == 200, response.text
    assert response.json()["signed_copy_content_type"] == "image/png"
    assert response.json()["signed_copy_size"] == len(PNG_BYTES)

    download = client.get(f"/api/v1/applications/{application.id}/provisional-order/signed-copy", headers=headers)
    assert download.status_code == 200
    assert download.content == PNG_BYTES

    # A PDF scan replaces it (the letter itself stands in for a scan).
    letter = client.get(f"/api/v1/applications/{application.id}/provisional-order/letter.pdf", headers=headers).content
    replaced = _upload(client, headers, application, letter, "application/pdf")
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["signed_copy_content_type"] == "application/pdf"


@pytest.mark.parametrize(
    "data,content_type,detail",
    [
        (b"hello", "text/plain", "Only PDF, JPEG or PNG"),
        (PNG_BYTES, "application/pdf", "does not match"),
        (b"%PDF" + b"\x00" * (10 * 1024 * 1024), "application/pdf", "10 MB"),
    ],
)
def test_signed_copy_validation(client, joined, data, content_type, detail):
    vacancy, application = joined()
    headers = auth_headers(client, vacancy.hr_admin)
    _issue(client, headers, application)
    response = _upload(client, headers, application, data, content_type)
    assert response.status_code == 400
    assert detail in response.json()["detail"]


def test_signed_copy_storage_down_is_502(client, joined, fake_minio_client):
    vacancy, application = joined()
    headers = auth_headers(client, vacancy.hr_admin)
    _issue(client, headers, application)
    fake_minio_client.fail_puts = True
    assert _upload(client, headers, application, PNG_BYTES, "image/png", name="s.png").status_code == 502


# ------------------------------------------------------- department options


def _options_setup(db_session, joined, department_factory, designation_factory, sanctioned_strength_factory):
    vacancy, application = joined()
    appointment_orders.issue_provisional_order(db_session, application=application, actor=vacancy.hr_admin)
    designation = designation_factory(name="Assistant Professor", department=vacancy.department)
    vacancy.vacancy_request.designation_id = designation.id
    cse = department_factory("SSE", name="Computer Science and Engineering", category=StaffRoleCategoryEnum.TEACHING)
    civil = department_factory("SSE", name="Civil Engineering", category=StaffRoleCategoryEnum.TEACHING)
    elsewhere = department_factory("SCAD", name="Computer Science Elsewhere", category=StaffRoleCategoryEnum.TEACHING)
    for department, approved, campus in ((cse, 3, vacancy.campus), (civil, 1, vacancy.campus), (elsewhere, 4, elsewhere.campus)):
        row = sanctioned_strength_factory(
            campus=campus, department=department, designation=designation, approved_strength=approved,
            created_by=vacancy.hr_admin,
        )
        if department is cse:
            row.working_override = 1
    db_session.flush()
    return vacancy, application, designation, cse, civil


def test_options_show_vacancy_and_suggestion(
    db_session, joined, application_factory, department_factory, designation_factory, sanctioned_strength_factory
):
    vacancy, application, designation, cse, civil = _options_setup(
        db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
    )
    db_session.add(ResumeScore(application_id=application.id, extracted_qualification="M.E. Computer Science"))
    # Someone else already allotted to Civil, not yet handed over: reserved.
    other = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    other.status = ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED
    other.department_allotted_id = civil.id
    db_session.flush()

    result = department_options(db_session, application)
    assert result["suggestion_basis"] == "RESUME_QUALIFICATION"
    names = [o["department_name"] for o in result["options"]]
    assert names == ["Computer Science and Engineering", "Civil Engineering"]  # suggested first, other campus out
    first, second = result["options"]
    assert (first["sanctioned"], first["working"], first["reserved"], first["vacancy"], first["suggested"]) == (3, 1, 0, 2, True)
    assert (second["sanctioned"], second["working"], second["reserved"], second["vacancy"], second["suggested"]) == (1, 0, 1, 0, False)


def test_options_fall_back_to_vacancy_text(
    client, db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
):
    vacancy, application, *_ = _options_setup(
        db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
    )
    response = client.get(
        f"/api/v1/applications/{application.id}/department-options", headers=auth_headers(client, vacancy.hr_admin)
    )
    assert response.status_code == 200
    assert response.json()["suggestion_basis"] == "VACANCY"
    assert len(response.json()["options"]) == 2


def _allot(client, headers, application, department, **extra):
    return client.post(
        f"/api/v1/applications/{application.id}/joining/allot-department-room",
        headers=headers,
        json={"department_id": str(department.id), "room_allotted": "R-1", **extra},
    )


def test_zero_vacancy_is_refused_and_override_rules(
    client, db_session, joined, user_factory, department_factory, designation_factory, sanctioned_strength_factory
):
    vacancy, application, designation, cse, civil = _options_setup(
        db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
    )
    # Make Civil full: its one seat is held by someone working there.
    db_session.query(SanctionedStrength).filter(SanctionedStrength.department_id == civil.id).one().working_override = 1
    db_session.flush()

    hr = auth_headers(client, vacancy.hr_admin)
    refused = _allot(client, hr, application, civil)
    assert refused.status_code == 409
    assert "no vacancy" in refused.json()["detail"]

    assert _allot(client, hr, application, civil, override_reason="Need them there").status_code == 403

    super_admin = auth_headers(client, user_factory(UserRoleEnum.SUPER_ADMIN))
    assert _allot(client, super_admin, application, civil).status_code == 409  # reason required
    ok = _allot(client, super_admin, application, civil, override_reason="Principal's request")
    assert ok.status_code == 200, ok.text
    db_session.refresh(application)
    assert application.status == ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED
    assert application.department_allotted_id == civil.id
    override = (
        db_session.query(AuditLog).filter(AuditLog.action == "DEPARTMENT_ALLOTMENT_VACANCY_OVERRIDE").one()
    )
    assert override.after_state["override_reason"] == "Principal's request"
    assert override.entity_id == application.id


def test_allot_with_vacancy_succeeds(
    client, db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
):
    vacancy, application, designation, cse, civil = _options_setup(
        db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
    )
    response = _allot(client, auth_headers(client, vacancy.hr_admin), application, cse)
    assert response.status_code == 200, response.text
    assert db_session.query(AuditLog).filter(AuditLog.action == "DEPARTMENT_ALLOTMENT_VACANCY_OVERRIDE").count() == 0


def test_department_from_another_campus_is_refused(
    client, db_session, joined, user_factory, department_factory, designation_factory, sanctioned_strength_factory
):
    vacancy, application, *_ = _options_setup(
        db_session, joined, department_factory, designation_factory, sanctioned_strength_factory
    )
    other = department_factory("SCAD", name="Somewhere Else")
    response = _allot(client, auth_headers(client, user_factory(UserRoleEnum.SUPER_ADMIN)), application, other, override_reason="x")
    assert response.status_code == 400


# ---------------------------------------------------------- role/campus gates


def test_role_and_campus_gates(client, joined, user_factory):
    vacancy, application = joined()
    hod = auth_headers(client, user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE"))
    coordinator = auth_headers(client, user_factory(UserRoleEnum.RECRUITMENT_COORDINATOR))
    other_officer = auth_headers(client, user_factory(UserRoleEnum.RECRUITMENT_OFFICER, campus_code="SCAD"))
    base = f"/api/v1/applications/{application.id}"
    for headers, expected in ((hod, 403), (coordinator, 403), (other_officer, 404)):
        assert client.post(f"{base}/provisional-order", headers=headers).status_code == expected
        assert client.get(f"{base}/department-options", headers=headers).status_code == expected
        assert client.get(f"{base}/provisional-order/letter.pdf", headers=headers).status_code == expected

    own_officer = auth_headers(client, vacancy.recruitment_officer)
    assert client.post(f"{base}/provisional-order", headers=own_officer).status_code == 201


def test_number_clash_is_retried_once_then_refused(db_session, joined, monkeypatch):
    from app.services import reference_numbers

    vacancy, first = joined()
    _, second = joined(vacancy)
    _, third = joined(vacancy)
    taken = appointment_orders.issue_provisional_order(db_session, application=first, actor=vacancy.hr_admin)
    real = reference_numbers.next_provisional_order_number
    calls = []

    def clash_once(db, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            return taken.sequence, taken.order_number
        return real(db, **kwargs)

    monkeypatch.setattr(reference_numbers, "next_provisional_order_number", clash_once)
    order = appointment_orders.issue_provisional_order(db_session, application=second, actor=vacancy.hr_admin)
    assert order.sequence == taken.sequence + 1 and len(calls) == 2

    monkeypatch.setattr(
        reference_numbers, "next_provisional_order_number", lambda db, **kw: (taken.sequence, taken.order_number)
    )
    with pytest.raises(HTTPException) as exc:
        appointment_orders.issue_provisional_order(db_session, application=third, actor=vacancy.hr_admin)
    assert exc.value.status_code == 409
    assert third.status == ApplicationStatusEnum.JOINED


def test_register_floor_is_the_single_lookup(db_session, joined, monkeypatch):
    from app.services import reference_numbers

    monkeypatch.setattr(reference_numbers, "register_floor", lambda db, code: 500)
    vacancy, application = joined()
    order = appointment_orders.issue_provisional_order(db_session, application=application, actor=vacancy.hr_admin)
    assert order.sequence == 501
