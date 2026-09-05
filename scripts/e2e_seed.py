"""Master data for the Playwright suite (`e2e/`), on top of `app.db.seed`.

The specs discover their fixtures from the running API rather than hardcoding
ids (see `e2e/public-vacancy-request.spec.ts` and
`e2e/vacancy-request-wizard.spec.ts`), and fail with a plain message when the
environment lacks what they need:

  - a campus WITH locations and a campus WITHOUT any (the Location rule);
  - on the campus with locations, a TEACHING department that has a TEACHING
    designation LINKED to it (the wizard lists linked designations only), a
    NON_TEACHING-only department, and more than ten departments in all (the
    dropdown-height regression test);
  - on a campus without locations, any department with a linked designation.

`app.db.seed` creates campuses, users and demo workflow rows but NO
locations or designations and only two departments per campus, so a fresh
database (CI, or a new dev machine) cannot run the suite. This adds exactly
the master data above, by name, and is safe to re-run: every row is looked
up before it is created, and existing rows are never modified.

Refuses to run when ENVIRONMENT=production -- this is test fixture data.

    venv/Scripts/python.exe -m app.db.seed
    venv/Scripts/python.exe -m scripts.e2e_seed
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.campus import Campus  # noqa: E402
from app.models.department import Department  # noqa: E402
from app.models.designation import Designation  # noqa: E402
from app.models.enums import EmploymentTypeEnum, StaffRoleCategoryEnum  # noqa: E402
from app.models.location import Location  # noqa: E402

T, NT, HK = StaffRoleCategoryEnum.TEACHING, StaffRoleCategoryEnum.NON_TEACHING, StaffRoleCategoryEnum.HOUSEKEEPING

# The one campus given locations. Every other campus stays without any, which
# is what the "location is optional" tests need.
CAMPUS_WITH_LOCATIONS = "SSE"

LOCATIONS: list[tuple[str, str, str]] = [
    # name, block_building, floor_venue
    ("Main Block Ground Floor", "Main Block", "Ground Floor"),
    ("Main Block First Floor", "Main Block", "First Floor"),
    ("Library Block", "Library Block", "Reading Hall"),
]

# 12 teaching departments (> 10, for the scroll test) plus one NON_TEACHING-
# only and one HOUSEKEEPING-only, all on the campus with locations. The
# seeder's own "Administration" / "Human Resources" (NON_TEACHING) are left
# as they are.
DEPARTMENTS: list[tuple[str, list[StaffRoleCategoryEnum]]] = [
    ("Computer Science and Engineering", [T, NT]),
    ("Electronics and Communication Engineering", [T, NT]),
    ("Electrical and Electronics Engineering", [T, NT]),
    ("Mechanical Engineering", [T, NT]),
    ("Civil Engineering", [T, NT]),
    ("Information Technology", [T, NT]),
    ("Artificial Intelligence and Data Science", [T, NT]),
    ("Biomedical Engineering", [T, NT]),
    ("Chemical Engineering", [T, NT]),
    ("Mathematics", [T]),
    ("Physics", [T]),
    ("Chemistry", [T]),
    ("Library Services", [NT]),
    ("Facilities and Maintenance", [HK]),
]

DESIGNATIONS: list[tuple[str, StaffRoleCategoryEnum, str, str]] = [
    # name, category, qualification, min_experience
    ("Professor", T, "PhD in the relevant discipline", "10 years"),
    ("Associate Professor", T, "PhD in the relevant discipline", "5 years"),
    ("Assistant Professor", T, "ME/MTech or PhD in the relevant discipline", "0 years"),
    ("Lab Assistant", NT, "Diploma or BSc in the relevant discipline", "1 year"),
    ("Office Assistant", NT, "Any degree", "1 year"),
    ("Housekeeping Staff", HK, "No formal qualification required", "0 years"),
]


def main() -> None:
    if settings.is_production:
        sys.exit("refusing to seed e2e fixture data with ENVIRONMENT=production")

    db = SessionLocal()
    created = {"departments": 0, "locations": 0, "designations": 0, "links": 0}
    try:
        campus = db.query(Campus).filter(Campus.code == CAMPUS_WITH_LOCATIONS).one_or_none()
        if campus is None:
            sys.exit(f"campus {CAMPUS_WITH_LOCATIONS} not found -- run `python -m app.db.seed` first")

        for name, categories in DEPARTMENTS:
            exists = (
                db.query(Department).filter(Department.campus_id == campus.id, Department.name == name).one_or_none()
            )
            if exists is None:
                db.add(Department(campus_id=campus.id, name=name, supported_categories=categories))
                created["departments"] += 1
        db.flush()

        for name, block, floor in LOCATIONS:
            exists = db.query(Location).filter(Location.campus_id == campus.id, Location.name == name).one_or_none()
            if exists is None:
                db.add(Location(campus_id=campus.id, name=name, block_building=block, floor_venue=floor))
                created["locations"] += 1

        # Link every designation to every active department, on ANY campus,
        # that supports its category -- so the campuses without locations
        # have linked designations too (the wizard's optional-location tests).
        departments = db.query(Department).filter(Department.is_active.is_(True)).all()
        for name, category, qualification, experience in DESIGNATIONS:
            designation = db.query(Designation).filter(Designation.name == name).one_or_none()
            if designation is None:
                designation = Designation(
                    name=name,
                    category=category,
                    qualification=qualification,
                    min_experience=experience,
                    employment_type=EmploymentTypeEnum.FULL_TIME,
                )
                db.add(designation)
                db.flush()
                created["designations"] += 1
            linked = {d.id for d in designation.departments}
            for department in departments:
                if department.supports(designation.category) and department.id not in linked:
                    designation.departments.append(department)
                    created["links"] += 1

        db.commit()
        print(
            "e2e seed complete: "
            + ", ".join(f"{count} {kind} created" for kind, count in created.items())
            + " (existing rows untouched)"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
