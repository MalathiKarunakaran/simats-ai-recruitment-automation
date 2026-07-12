"""Idempotent local/dev seed data. Run with: python -m app.db.seed

Seeds exactly the 7 institutional campus codes, a couple of generic
departments per campus, a Super Admin, and a sample user for every role --
critically including HOD@SSE and HOD@SCAD (two different campuses), which
the Phase 1 test suite relies on to exercise cross-campus RBAC denial.
"""

import secrets

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import CAMPUS_CODES, UserRoleEnum
from app.models.user import User

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

        _get_or_create_user(
            db,
            email="hr.admin@example.com",
            password=sample_password,
            full_name="HR Admin",
            role=UserRoleEnum.HR_ADMIN,
        )
        _get_or_create_user(
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
        _get_or_create_user(
            db,
            email="hod.sse@example.com",
            password=sample_password,
            full_name="HOD - SSE",
            role=UserRoleEnum.CAMPUS_HOD,
            campus=campuses["SSE"],
            department=departments["SSE"][0],
        )
        _get_or_create_user(
            db,
            email="hod.scad@example.com",
            password=sample_password,
            full_name="HOD - SCAD",
            role=UserRoleEnum.CAMPUS_HOD,
            campus=campuses["SCAD"],
            department=departments["SCAD"][0],
        )
        _get_or_create_user(
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

        db.commit()
        print(f"Seed complete: {len(campuses)} campuses, sample users across all 8 roles.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
