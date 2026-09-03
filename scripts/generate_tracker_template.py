"""Writes data/SIMATS_Recruitment_Tracker_TEMPLATE.xlsx for anyone who wants
the tracker template as a file on disk -- e.g. to attach to an email or
hand to HR outside the app.

The app itself no longer needs this: GET /migration/tracker-template builds
the workbook in memory on every request from `app/services/tracker_template.py`,
which is also the only place the template's content lives. This script is
the same builder written to a file, nothing more, so the two can never
disagree.

Usage, from anywhere:
    venv/Scripts/python.exe scripts/generate_tracker_template.py
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from app.services.tracker_template import TEMPLATE_FILENAME, build_workbook  # noqa: E402
from app.services.xlsx_safety import harden_workbook  # noqa: E402

OUTPUT_PATH = REPO_ROOT / "data" / TEMPLATE_FILENAME


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    harden_workbook(build_workbook()).save(OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
