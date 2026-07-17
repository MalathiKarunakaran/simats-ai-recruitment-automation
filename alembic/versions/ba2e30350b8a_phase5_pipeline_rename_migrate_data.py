"""phase5_pipeline_rename_migrate_data

Revision ID: ba2e30350b8a
Revises: f32d13801269
Create Date: 2026-07-17 19:56:20.141901

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ba2e30350b8a'
down_revision: Union[str, Sequence[str], None] = 'f32d13801269'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Old label -> new label. Several old labels collapse onto the same new one
# (TECHNICAL_INTERVIEW/HR_INTERVIEW both become INTERVIEWED; SHORTLISTED/
# INTERVIEW_SCHEDULED both become CALLED_FOR_INTERVIEW) since the real
# manual process doesn't distinguish them the way the old generic pipeline
# did. Must run in its own migration, after f32d13801269 committed the new
# enum labels -- Postgres won't let a value be used in the same transaction
# that added it.
_FORWARD_MAP = {
    "ELIGIBLE": "SCREENING",
    "SHORTLISTED": "CALLED_FOR_INTERVIEW",
    "INTERVIEW_SCHEDULED": "CALLED_FOR_INTERVIEW",
    "TECHNICAL_INTERVIEW": "INTERVIEWED",
    "HR_INTERVIEW": "INTERVIEWED",
    "JOINING_PENDING": "JOINING_CONFIRMED",
    "ONBOARDING_COMPLETE": "DEPARTMENT_ROOM_ALLOTTED",
    "EMPLOYEE_CREATED": "HANDED_OVER_TO_HOD",
}

# Reverse mapping for downgrade -- necessarily lossy where multiple old
# labels collapsed onto one new label (e.g. any row currently
# CALLED_FOR_INTERVIEW reverts to SHORTLISTED even if it was originally
# INTERVIEW_SCHEDULED). Acceptable: downgrade on this repo's own native-enum
# migrations has never been a lossless round-trip (see 023e1b89bbec).
_REVERSE_MAP = {
    "SCREENING": "ELIGIBLE",  # only reachable rows that were ELIGIBLE; true SCREENING rows are left alone below
    "CALLED_FOR_INTERVIEW": "SHORTLISTED",
    "INTERVIEWED": "TECHNICAL_INTERVIEW",
    "JOINING_CONFIRMED": "JOINING_PENDING",
    "DEPARTMENT_ROOM_ALLOTTED": "ONBOARDING_COMPLETE",
    "HANDED_OVER_TO_HOD": "EMPLOYEE_CREATED",
}


def upgrade() -> None:
    """Upgrade schema."""
    for old_value, new_value in _FORWARD_MAP.items():
        op.execute(
            f"UPDATE applications SET status = '{new_value}' WHERE status = '{old_value}'"
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Lossy by necessity -- see _REVERSE_MAP comment. SCREENING is
    # deliberately left alone (both true-SCREENING and former-ELIGIBLE rows
    # are indistinguishable after upgrade) rather than guessed at.
    for new_value, old_value in _REVERSE_MAP.items():
        if new_value == "SCREENING":
            continue
        op.execute(
            f"UPDATE applications SET status = '{old_value}' WHERE status = '{new_value}'"
        )
