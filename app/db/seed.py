"""Idempotent local/dev seed data. Run with: python -m app.db.seed

Seeds exactly the 7 institutional campus codes, a couple of generic
departments per campus, a Super Admin, and a sample user for every role --
critically including HOD@SSE and HOD@SCAD (two different campuses), which
the Phase 1 test suite relies on to exercise cross-campus RBAC denial.

Also seeds three Phase 2 vacancy-workflow scenarios (see _seed_phase2_demo)
exercising the full requisition -> approval -> pipeline -> offer -> joining
-> auto-close lifecycle end-to-end, using the same service functions the API
uses (not hand-rolled shortcuts), so the seed run is itself a smoke test of
the Module 2/7/9/10/11 business logic.
"""

import secrets
from datetime import date, datetime, timedelta, timezone

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.application import Application
from app.models.candidate import Candidate
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import (
    CAMPUS_CODES,
    ApplicationStatusEnum,
    EmploymentTypeEnum,
    JoiningDocumentStatusEnum,
    OfferStatusEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
    VacancyPriorityEnum,
)
from app.models.joining import JoiningDocument
from app.models.offer import Offer
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import joining as joining_service
from app.services import pipeline, vacancy_workflow

GENERIC_DEPARTMENTS = ("Administration", "Human Resources")


def _get_or_create_campus(db, code: str) -> Campus:
    campus = db.query(Campus).filter(Campus.code == code).one_or_none()
    if campus is None:
        campus = Campus(code=code, name=f"Campus — {code} (TODO: update with official name)")
        db.add(campus)
        db.flush()
    return campus


def _get_or_create_department(db, campus: Campus, name: str) -> Department:
    dept = (
        db.query(Department)
        .filter(Department.campus_id == campus.id, Department.name == name)
        .one_or_none()
    )
    if dept is None:
        dept = Department(campus_id=campus.id, name=name)
        db.add(dept)
        db.flush()
    return dept


def _get_or_create_candidate(
    db, *, email: str, full_name: str, phone_number: str | None = None, source: str | None = None
) -> Candidate:
    candidate = db.query(Candidate).filter(Candidate.email == email).one_or_none()
    if candidate is None:
        candidate = Candidate(full_name=full_name, email=email, phone_number=phone_number, source=source)
        db.add(candidate)
        db.flush()
    return candidate


def _get_or_create_user(
    db,
    *,
    email: str,
    password: str,
    full_name: str,
    role: UserRoleEnum,
    campus: Campus | None = None,
    department: Department | None = None,
) -> User:
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(password),
            full_name=full_name,
            role=role,
            campus_id=campus.id if campus else None,
            department_id=department.id if department else None,
        )
        db.add(user)
        db.flush()
    return user


def _get_existing_vacancy_request(db, campus: Campus, position_title: str) -> VacancyRequest | None:
    return (
        db.query(VacancyRequest)
        .filter(VacancyRequest.campus_id == campus.id, VacancyRequest.position_title == position_title)
        .one_or_none()
    )


def _seed_scenario_full_happy_path(db, *, campus, department, hod, dean, hr_admin, recruitment_officer) -> None:
    """Two-slot vacancy at SSE, driven all the way through: one slot filled
    via the full offer/joining/onboarding flow ending in EMPLOYEE_CREATED,
    the other slot Selected-then-Rejected (exercising slot release) and
    re-filled by a third candidate directly to Joined, which triggers
    Module 11's auto-close once both slots are Filled."""
    position_title = "Assistant Professor"
    if _get_existing_vacancy_request(db, campus, position_title) is not None:
        return

    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title=position_title,
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=2,
        qualification="PhD in Computer Science or related field",
        experience_required="3+ years teaching experience",
        priority=VacancyPriorityEnum.HIGH,
        requested_by_id=hod.id,
    )
    db.add(vr)
    db.flush()

    vacancy_workflow.submit(db, vr, hod, None)
    vacancy_workflow.dean_approve(db, vr, dean, None)
    approved_vacancy = vacancy_workflow.hr_approve(db, vr, hr_admin, None)
    job_posting = vacancy_workflow.publish(db, vr, approved_vacancy, hr_admin, None)
    db.flush()

    now = datetime.now(timezone.utc)
    joining_date = date.today() + timedelta(days=14)

    def _record_application(email: str, full_name: str) -> Application:
        candidate = _get_or_create_candidate(db, email=email, full_name=full_name, source="Seed demo")
        application = Application(
            candidate_id=candidate.id,
            job_posting_id=job_posting.id,
            campus_id=job_posting.campus_id,
            applied_at=now,
            recorded_by_id=recruitment_officer.id,
        )
        db.add(application)
        db.flush()
        return application

    # Candidate A: full happy path -> EMPLOYEE_CREATED, fills slot 1.
    app_a = _record_application("alice.faculty@example.com", "Alice Faculty")
    for target in (ApplicationStatusEnum.SCREENING, ApplicationStatusEnum.ELIGIBLE, ApplicationStatusEnum.SHORTLISTED):
        pipeline.transition_application_status(db, application=app_a, new_status=target, actor=recruitment_officer)
    pipeline.transition_application_status(
        db, application=app_a, new_status=ApplicationStatusEnum.SELECTED, actor=hr_admin
    )

    offer_a = Offer(
        application_id=app_a.id,
        offered_by_id=hr_admin.id,
        salary_amount=75000,
        joining_date=joining_date,
    )
    db.add(offer_a)
    db.flush()
    offer_a.status = OfferStatusEnum.SENT
    offer_a.sent_at = now
    pipeline.advance_if_behind(
        db, application=app_a, target_status=ApplicationStatusEnum.OFFER_SENT, actor=hr_admin
    )
    offer_a.status = OfferStatusEnum.ACCEPTED
    offer_a.responded_at = now
    pipeline.advance_if_behind(
        db, application=app_a, target_status=ApplicationStatusEnum.OFFER_ACCEPTED, actor=hr_admin
    )
    pipeline.advance_if_behind(
        db, application=app_a, target_status=ApplicationStatusEnum.JOINING_PENDING, actor=hr_admin
    )
    joining_record_a = joining_service.initialize_joining_checklist(
        db, application=app_a, joining_date=offer_a.joining_date, actor=hr_admin
    )
    db.flush()
    for doc in db.query(JoiningDocument).filter(JoiningDocument.application_id == app_a.id).all():
        doc.status = JoiningDocumentStatusEnum.RECEIVED
        doc.received_at = now
    db.flush()

    pipeline.transition_application_status(
        db, application=app_a, new_status=ApplicationStatusEnum.JOINED, actor=hr_admin
    )
    joining_record_a.actual_joining_date = joining_date
    joining_service.complete_onboarding(
        db, application=app_a, joining_record=joining_record_a, actor=hr_admin
    )
    pipeline.transition_application_status(
        db, application=app_a, new_status=ApplicationStatusEnum.ONBOARDING_COMPLETE, actor=hr_admin
    )
    joining_service.create_employee(
        db, application=app_a, joining_record=joining_record_a, designation=None, actor=hr_admin
    )
    pipeline.transition_application_status(
        db, application=app_a, new_status=ApplicationStatusEnum.EMPLOYEE_CREATED, actor=hr_admin
    )

    # Candidate B: Selected (reserves slot 2), then Rejected -- exercises slot release.
    app_b = _record_application("bob.faculty@example.com", "Bob Faculty")
    pipeline.transition_application_status(
        db, application=app_b, new_status=ApplicationStatusEnum.SHORTLISTED, actor=recruitment_officer
    )
    pipeline.transition_application_status(
        db, application=app_b, new_status=ApplicationStatusEnum.SELECTED, actor=hr_admin
    )
    pipeline.transition_application_status(
        db,
        application=app_b,
        new_status=ApplicationStatusEnum.REJECTED,
        actor=hr_admin,
        reason="Did not clear background verification",
    )

    # Candidate C: re-reserves the now-open slot 2, driven straight to Joined
    # (demonstrating the "skip stages ahead" transition rule) -- fills the
    # last slot, which should trigger Module 11's vacancy auto-close.
    app_c = _record_application("carol.faculty@example.com", "Carol Faculty")
    pipeline.transition_application_status(
        db, application=app_c, new_status=ApplicationStatusEnum.SELECTED, actor=hr_admin
    )
    pipeline.transition_application_status(
        db, application=app_c, new_status=ApplicationStatusEnum.JOINED, actor=hr_admin
    )


def _seed_scenario_mid_chain(db, *, campus, department, hod) -> None:
    """Left at SUBMITTED for manual Swagger exploration of dean-approve/reject."""
    position_title = "Lab Assistant"
    if _get_existing_vacancy_request(db, campus, position_title) is not None:
        return

    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.NON_TEACHING,
        position_title=position_title,
        employment_type=EmploymentTypeEnum.FULL_TIME,
        requested_count=1,
        qualification="B.Sc with lab experience",
        experience_required="1+ years",
        priority=VacancyPriorityEnum.NORMAL,
        requested_by_id=hod.id,
    )
    db.add(vr)
    db.flush()
    vacancy_workflow.submit(db, vr, hod, None)


def _seed_scenario_early_rejection(db, *, campus, department, requested_by, dean) -> None:
    """Driven SUBMITTED -> REJECTED directly (Dean-stage rejection), distinct
    from scenario 1's later offer-stage rejection."""
    position_title = "Guest Lecturer"
    if _get_existing_vacancy_request(db, campus, position_title) is not None:
        return

    vr = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        role_category=StaffRoleCategoryEnum.TEACHING,
        position_title=position_title,
        employment_type=EmploymentTypeEnum.VISITING,
        requested_count=1,
        qualification="Masters degree in relevant subject",
        experience_required="No prior experience required",
        priority=VacancyPriorityEnum.LOW,
        requested_by_id=requested_by.id,
    )
    db.add(vr)
    db.flush()
    vacancy_workflow.submit(db, vr, requested_by, None)
    vacancy_workflow.reject(db, vr, dean, "Budget not approved for this cycle", None)


def _seed_phase2_demo(
    db, *, campuses, departments, hod_sse, hod_scad, associate_dean, hr_admin, recruitment_officer_sse
) -> None:
    _seed_scenario_full_happy_path(
        db,
        campus=campuses["SSE"],
        department=departments["SSE"][0],
        hod=hod_sse,
        dean=associate_dean,
        hr_admin=hr_admin,
        recruitment_officer=recruitment_officer_sse,
    )
    _seed_scenario_mid_chain(
        db, campus=campuses["SCAD"], department=departments["SCAD"][0], hod=hod_scad
    )
    _seed_scenario_early_rejection(
        db,
        campus=campuses["SSE"],
        department=departments["SSE"][1],
        requested_by=hod_sse,
        dean=associate_dean,
    )


def seed() -> None:
    db = SessionLocal()
    try:
        campuses = {code: _get_or_create_campus(db, code) for code in CAMPUS_CODES}
        db.flush()

        departments: dict[str, list[Department]] = {}
        for code, campus in campuses.items():
            departments[code] = [
                _get_or_create_department(db, campus, name) for name in GENERIC_DEPARTMENTS
            ]

        super_admin_password = settings.SEED_SUPER_ADMIN_PASSWORD or secrets.token_urlsafe(16)
        already_existed = (
            db.query(User).filter(User.email == settings.SEED_SUPER_ADMIN_EMAIL).one_or_none()
            is not None
        )
        _get_or_create_user(
            db,
            email=settings.SEED_SUPER_ADMIN_EMAIL,
            password=super_admin_password,
            full_name="Super Admin",
            role=UserRoleEnum.SUPER_ADMIN,
        )
        if not already_existed and not settings.SEED_SUPER_ADMIN_PASSWORD:
            print(
                "\n=== SEEDED SUPER ADMIN ===\n"
                f"  email:    {settings.SEED_SUPER_ADMIN_EMAIL}\n"
                f"  password: {super_admin_password}\n"
                "  (auto-generated -- save this now, it will not be shown again)\n"
            )

        sample_password = settings.SEED_SAMPLE_USER_PASSWORD

        hr_admin = _get_or_create_user(
            db,
            email="hr.admin@example.com",
            password=sample_password,
            full_name="HR Admin",
            role=UserRoleEnum.HR_ADMIN,
        )
        associate_dean = _get_or_create_user(
            db,
            email="associate.dean@example.com",
            password=sample_password,
            full_name="Associate Dean (Recruitment)",
            role=UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
        )
        _get_or_create_user(
            db,
            email="management@example.com",
            password=sample_password,
            full_name="Management",
            role=UserRoleEnum.MANAGEMENT,
        )
        hod_sse = _get_or_create_user(
            db,
            email="hod.sse@example.com",
            password=sample_password,
            full_name="HOD - SSE",
            role=UserRoleEnum.CAMPUS_HOD,
            campus=campuses["SSE"],
            department=departments["SSE"][0],
        )
        hod_scad = _get_or_create_user(
            db,
            email="hod.scad@example.com",
            password=sample_password,
            full_name="HOD - SCAD",
            role=UserRoleEnum.CAMPUS_HOD,
            campus=campuses["SCAD"],
            department=departments["SCAD"][0],
        )
        recruitment_officer_sse = _get_or_create_user(
            db,
            email="recruitment.officer.sse@example.com",
            password=sample_password,
            full_name="Recruitment Officer - SSE",
            role=UserRoleEnum.RECRUITMENT_OFFICER,
            campus=campuses["SSE"],
        )
        _get_or_create_user(
            db,
            email="panel.member.scad@example.com",
            password=sample_password,
            full_name="Interview Panel Member - SCAD",
            role=UserRoleEnum.INTERVIEW_PANEL_MEMBER,
            campus=campuses["SCAD"],
        )
        _get_or_create_user(
            db,
            email="candidate@example.com",
            password=sample_password,
            full_name="Sample Candidate",
            role=UserRoleEnum.CANDIDATE,
        )

        _seed_phase2_demo(
            db,
            campuses=campuses,
            departments=departments,
            hod_sse=hod_sse,
            hod_scad=hod_scad,
            associate_dean=associate_dean,
            hr_admin=hr_admin,
            recruitment_officer_sse=recruitment_officer_sse,
        )

        db.commit()
        print(f"Seed complete: {len(campuses)} campuses, sample users across all 8 roles, Phase 2 demo scenarios.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
