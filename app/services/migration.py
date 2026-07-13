"""Phase 6: best-effort legacy vacancy CSV import. Column mapping is a
documented placeholder -- the real Airtable export schema used by the
existing n8n + Airtable + Gmail + Telegram pipeline wasn't available to us,
same caveat class as Phase 5's placeholder PPT branding.

Every imported row lands as a DRAFT VacancyRequest for human review; nothing
here calls vacancy_workflow.submit() or otherwise skips the normal
submit -> dean-approve -> HR-approve -> publish chain.

Expected CSV columns:
  Required: campus_code, department_name, position_title, role_category,
            employment_type, requested_count, qualification,
            experience_required
  Optional: salary_band_min, salary_band_max, priority,
            skills (semicolon-separated), jd_draft
"""

import csv
import io

from sqlalchemy.orm import Session

from app.models.campus import Campus
from app.models.department import Department
from app.models.enums import CAMPUS_CODES, EmploymentTypeEnum, StaffRoleCategoryEnum, VacancyPriorityEnum
from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services.audit import log_event

REQUIRED_COLUMNS: tuple[str, ...] = (
    "campus_code",
    "department_name",
    "position_title",
    "role_category",
    "employment_type",
    "requested_count",
    "qualification",
    "experience_required",
)


def _get_or_create_department(db: Session, campus: Campus, name: str) -> Department:
    department = (
        db.query(Department).filter(Department.campus_id == campus.id, Department.name == name).one_or_none()
    )
    if department is None:
        department = Department(campus_id=campus.id, name=name)
        db.add(department)
        db.flush()
    return department


def _parse_row(db: Session, row: dict, actor: User) -> tuple[VacancyRequest | None, list[str]]:
    errors: list[str] = []
    for column in REQUIRED_COLUMNS:
        if not (row.get(column) or "").strip():
            errors.append(f"Missing required column '{column}'")

    campus = None
    campus_code = (row.get("campus_code") or "").strip().upper()
    if campus_code and campus_code not in CAMPUS_CODES:
        errors.append(f"Unknown campus_code '{campus_code}'")
    elif campus_code:
        campus = db.query(Campus).filter(Campus.code == campus_code).one_or_none()
        if campus is None:
            errors.append(f"Campus '{campus_code}' is not seeded in this environment")

    role_category = None
    role_category_raw = (row.get("role_category") or "").strip().upper()
    if role_category_raw:
        try:
            role_category = StaffRoleCategoryEnum[role_category_raw]
        except KeyError:
            errors.append(f"Invalid role_category '{row.get('role_category')}'")

    employment_type = None
    employment_type_raw = (row.get("employment_type") or "").strip().upper()
    if employment_type_raw:
        try:
            employment_type = EmploymentTypeEnum[employment_type_raw]
        except KeyError:
            errors.append(f"Invalid employment_type '{row.get('employment_type')}'")

    requested_count = None
    requested_count_raw = (row.get("requested_count") or "").strip()
    if requested_count_raw:
        try:
            requested_count = int(requested_count_raw)
            if requested_count <= 0:
                errors.append("requested_count must be positive")
        except ValueError:
            errors.append(f"Invalid requested_count '{row.get('requested_count')}'")

    priority = VacancyPriorityEnum.NORMAL
    priority_raw = (row.get("priority") or "").strip().upper()
    if priority_raw:
        try:
            priority = VacancyPriorityEnum[priority_raw]
        except KeyError:
            errors.append(f"Invalid priority '{row.get('priority')}'")

    salary_band_min = None
    if (row.get("salary_band_min") or "").strip():
        try:
            salary_band_min = float(row["salary_band_min"])
        except ValueError:
            errors.append(f"Invalid salary_band_min '{row.get('salary_band_min')}'")

    salary_band_max = None
    if (row.get("salary_band_max") or "").strip():
        try:
            salary_band_max = float(row["salary_band_max"])
        except ValueError:
            errors.append(f"Invalid salary_band_max '{row.get('salary_band_max')}'")

    if errors:
        return None, errors

    department = _get_or_create_department(db, campus, row["department_name"].strip())
    skills = [s.strip() for s in row["skills"].split(";") if s.strip()] if row.get("skills") else None

    vacancy_request = VacancyRequest(
        campus_id=campus.id,
        department_id=department.id,
        role_category=role_category,
        position_title=row["position_title"].strip(),
        employment_type=employment_type,
        requested_count=requested_count,
        qualification=row["qualification"].strip(),
        experience_required=row["experience_required"].strip(),
        salary_band_min=salary_band_min,
        salary_band_max=salary_band_max,
        jd_draft=row.get("jd_draft") or None,
        skills=skills,
        priority=priority,
        requested_by_id=actor.id,
    )
    return vacancy_request, []


def import_legacy_vacancies(db: Session, *, csv_bytes: bytes, actor: User, request=None) -> dict:
    text = csv_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows_result: list[dict] = []
    created_count = 0

    for row_number, row in enumerate(reader, start=2):  # header is row 1
        vacancy_request, errors = _parse_row(db, row, actor)
        if errors:
            rows_result.append(
                {"row_number": row_number, "status": "error", "vacancy_request_id": None, "errors": errors}
            )
            continue
        db.add(vacancy_request)
        db.flush()
        created_count += 1
        rows_result.append(
            {"row_number": row_number, "status": "created", "vacancy_request_id": vacancy_request.id, "errors": []}
        )

    log_event(
        db,
        actor=actor,
        action="LEGACY_VACANCIES_IMPORTED",
        entity_type="VacancyRequest",
        after_state={
            "total_rows": len(rows_result),
            "created_count": created_count,
            "error_count": len(rows_result) - created_count,
        },
        request=request,
    )
    return {
        "total_rows": len(rows_result),
        "created_count": created_count,
        "error_count": len(rows_result) - created_count,
        "rows": rows_result,
    }
