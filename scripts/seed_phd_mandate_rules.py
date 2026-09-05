"""Create the institutional "PhD mandatory for every teaching post" rules.

At SIMATS a PhD is mandatory for teaching appointments at some colleges and
not at others. Confirmed by the recruitment head on 2026-09-05:

    mandatory:      SSE, SCLAS, SSPE
    not mandatory:  SCAD, STUDIO, SHIFT, SPIER

The rule is data, not code: one ACTIVE TEACHING `EligibilityRule` per
mandatory campus with `phd_required=True` and no position / department
restriction (= every teaching post there). `app/services/eligibility.py::
check_candidate_phd_requirement` reads these at resume screening, and
`pipeline.py` refuses to call a flagged candidate for interview without an
HR override. Change the list later on the Eligibility Rules screen: deactivate
a rule to lift the mandate, add one (or a department-specific one) to extend it.

Idempotent: a campus that already has an active wildcard TEACHING rule with
phd_required is left exactly as it is.

    venv/Scripts/python.exe -m scripts.seed_phd_mandate_rules            # apply
    venv/Scripts/python.exe -m scripts.seed_phd_mandate_rules --dry-run  # report only
    docker exec -w /app simats_recruitment_backend python -m scripts.seed_phd_mandate_rules
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.models.campus import Campus  # noqa: E402
from app.models.eligibility_rule import EligibilityRule  # noqa: E402
from app.models.enums import EligibilityRuleStatusEnum, StaffRoleCategoryEnum  # noqa: E402

PHD_MANDATORY_CAMPUSES: tuple[str, ...] = ("SSE", "SCLAS", "SSPE")

NOTES = (
    "Institutional rule: a PhD is mandatory for every teaching appointment at this college "
    "(confirmed by the recruitment head, 2026-09-05). Deactivate to lift the mandate."
)


def seed_phd_mandate_rules(db: Session, campus_codes: tuple[str, ...] = PHD_MANDATORY_CAMPUSES) -> dict:
    """Returns {campus_code: "created" | "exists" | "no such campus"}."""
    outcome: dict[str, str] = {}
    for code in campus_codes:
        campus = db.query(Campus).filter(Campus.code == code).one_or_none()
        if campus is None:
            outcome[code] = "no such campus"
            continue
        existing = (
            db.query(EligibilityRule)
            .filter(
                EligibilityRule.campus_id == campus.id,
                EligibilityRule.staff_category == StaffRoleCategoryEnum.TEACHING,
                EligibilityRule.position_title.is_(None),
                EligibilityRule.department_id.is_(None),
                EligibilityRule.phd_required.is_(True),
                EligibilityRule.is_active.is_(True),
            )
            .first()
        )
        if existing is not None:
            outcome[code] = "exists"
            continue
        db.add(
            EligibilityRule(
                campus_id=campus.id,
                staff_category=StaffRoleCategoryEnum.TEACHING,
                position_title=None,
                department_id=None,
                required_qualification_keyword="PHD",
                minimum_qualification="PhD in the relevant discipline.",
                phd_required=True,
                is_active=True,
                status=EligibilityRuleStatusEnum.ACTIVE,
                verification_required=False,
                source_regulation="SIMATS institutional recruitment policy (recruitment head, 2026-09-05).",
                notes=NOTES,
            )
        )
        outcome[code] = "created"
    db.flush()
    return outcome


def main(argv: list[str]) -> None:
    dry_run = "--dry-run" in argv
    db = SessionLocal()
    try:
        outcome = seed_phd_mandate_rules(db)
        for code, result in outcome.items():
            print(f"  {code}: {result}")
        if dry_run:
            db.rollback()
            print("dry run: nothing written")
        else:
            db.commit()
            print("PhD mandate rules: " + ", ".join(f"{c}={r}" for c, r in outcome.items()))
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1:])
