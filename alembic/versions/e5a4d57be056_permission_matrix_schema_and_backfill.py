"""permission_matrix_schema_and_backfill

Revision ID: e5a4d57be056
Revises: e5f6a7b8c9d0
Create Date: 2026-08-20 00:00:00.000000

Phase 1 (schema + services only) of the granular permission-matrix epic --
purely additive: a fresh permission_enum (31 values), a new
user_permission_grants table (the generalized, any-role successor to
coordinator_capability_grants), a new user_department_scope M2M table
(alongside, not replacing, the existing users.department_id single-FK), and
a one-time data backfill of both from current DB content.

CoordinatorCapabilityGrant / CoordinatorCapabilityEnum /
require_roles_or_coordinator_capability are untouched by this migration --
they keep working exactly as they do today; a later phase will cut routers
over to the new tables and retire the old ones.

permission_enum is created fresh for this migration's own new column, so --
unlike the ADD VALUE gotcha documented on application_status_enum
(023e1b89bbec) -- it can be cleanly dropped again in downgrade().
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5a4d57be056'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PERMISSION_VALUES = (
    # Vacancy Management (8)
    "VIEW_VACANCY",
    "CREATE_VACANCY_REQUEST",
    "EDIT_VACANCY_REQUEST",
    "APPROVE_VACANCY",
    "REJECT_VACANCY",
    "PUBLISH_VACANCY",
    "CLOSE_VACANCY",
    "CANCEL_VACANCY",
    # Candidates (5)
    "VIEW_CANDIDATES",
    "CREATE_CANDIDATE",
    "EDIT_CANDIDATE",
    "DELETE_CANDIDATE",
    "MANAGE_APPLICATIONS",
    # Interviews (4)
    "SCHEDULE_INTERVIEW",
    "RESCHEDULE_INTERVIEW",
    "CANCEL_INTERVIEW",
    "MARK_INTERVIEW_COMPLETED",
    # Recruitment (4)
    "JOB_DISTRIBUTION",
    "RESUME_SCREENING",
    "OFFERS",
    "ONBOARDING",
    # Administration (7)
    "VIEW_EMPLOYEES",
    "EDIT_EMPLOYEES",
    "MANAGE_DEPARTMENTS",
    "MANAGE_DESIGNATIONS",
    "MANAGE_LOCATIONS",
    "MANAGE_CAMPUSES",
    "MANAGE_USERS",
    # System (3)
    "ACTIVITY_LOG",
    "REPORTS",
    "SETTINGS",
)

# Mirrors app.services.permissions.DEFAULT_PERMISSIONS_BY_ROLE exactly
# (hardcoded here, not imported, per this repo's own migration convention --
# see ba2e30350b8a_phase5_pipeline_rename_migrate_data.py -- so this
# migration's behavior stays fixed at what it was written against, even if
# the service module's table changes later). RECRUITMENT_COORDINATOR is
# deliberately excluded here -- it's backfilled separately below from each
# coordinator's real CoordinatorCapabilityGrant rows, not this generic
# per-role default.
_DEFAULT_PERMISSIONS_BY_ROLE = {
    "HR_ADMIN": (
        "VIEW_VACANCY", "APPROVE_VACANCY", "REJECT_VACANCY", "PUBLISH_VACANCY",
        "CLOSE_VACANCY", "CANCEL_VACANCY", "VIEW_CANDIDATES", "CREATE_CANDIDATE",
        "EDIT_CANDIDATE", "MANAGE_APPLICATIONS", "SCHEDULE_INTERVIEW",
        "RESCHEDULE_INTERVIEW", "CANCEL_INTERVIEW", "JOB_DISTRIBUTION",
        "RESUME_SCREENING", "OFFERS", "ONBOARDING", "VIEW_EMPLOYEES",
        "EDIT_EMPLOYEES", "MANAGE_DEPARTMENTS", "MANAGE_LOCATIONS",
        "MANAGE_USERS", "ACTIVITY_LOG", "REPORTS", "SETTINGS",
    ),
    "ASSOCIATE_DEAN_RECRUITMENT": (
        "VIEW_VACANCY", "APPROVE_VACANCY", "REJECT_VACANCY", "VIEW_CANDIDATES",
        "VIEW_EMPLOYEES", "ACTIVITY_LOG", "REPORTS", "SETTINGS",
    ),
    "RECRUITMENT_OFFICER": (
        "VIEW_VACANCY", "PUBLISH_VACANCY", "VIEW_CANDIDATES", "CREATE_CANDIDATE",
        "EDIT_CANDIDATE", "MANAGE_APPLICATIONS", "SCHEDULE_INTERVIEW",
        "RESCHEDULE_INTERVIEW", "CANCEL_INTERVIEW", "JOB_DISTRIBUTION",
        "RESUME_SCREENING", "ONBOARDING", "MANAGE_LOCATIONS", "REPORTS", "SETTINGS",
    ),
    "CAMPUS_HOD": (
        "VIEW_VACANCY", "CREATE_VACANCY_REQUEST", "EDIT_VACANCY_REQUEST",
        "VIEW_CANDIDATES", "ACTIVITY_LOG", "REPORTS", "SETTINGS",
    ),
    "INTERVIEW_PANEL_MEMBER": (
        "VIEW_VACANCY", "VIEW_CANDIDATES", "MARK_INTERVIEW_COMPLETED", "REPORTS", "SETTINGS",
    ),
    "MANAGEMENT": (
        "VIEW_VACANCY", "VIEW_CANDIDATES", "VIEW_EMPLOYEES", "REPORTS", "SETTINGS",
    ),
}

# Minimal baseline every RECRUITMENT_COORDINATOR gets regardless of their old
# capability grants (not covered by any old CoordinatorCapabilityEnum value).
_COORDINATOR_BASELINE = ("VIEW_VACANCY", "VIEW_CANDIDATES", "REPORTS", "SETTINGS")

# Old CoordinatorCapabilityEnum value -> new granular PermissionEnum set.
_CAPABILITY_TO_PERMISSIONS = {
    "VACANCY_APPROVAL": (
        "APPROVE_VACANCY", "REJECT_VACANCY", "PUBLISH_VACANCY", "CLOSE_VACANCY", "CANCEL_VACANCY",
    ),
    "CANDIDATES_APPLICATIONS": (
        "CREATE_CANDIDATE", "EDIT_CANDIDATE", "MANAGE_APPLICATIONS",
    ),
    "INTERVIEWS": (
        "SCHEDULE_INTERVIEW", "RESCHEDULE_INTERVIEW", "CANCEL_INTERVIEW", "MARK_INTERVIEW_COMPLETED",
    ),
    "JOB_DISTRIBUTION_SCREENING": (
        "JOB_DISTRIBUTION", "RESUME_SCREENING",
    ),
}


def upgrade() -> None:
    """Upgrade schema."""
    permission_enum = postgresql.ENUM(*_PERMISSION_VALUES, name="permission_enum")
    permission_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "user_permission_grants",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("permission", postgresql.ENUM(*_PERMISSION_VALUES, name="permission_enum", create_type=False), nullable=False),
        sa.Column("granted_by_id", sa.UUID(), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_permission_grants_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["granted_by_id"],
            ["users.id"],
            name=op.f("fk_user_permission_grants_granted_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_permission_grants")),
        sa.UniqueConstraint("user_id", "permission", name="uq_user_permission_grant"),
    )
    op.create_index(
        op.f("ix_user_permission_grants_user_id"), "user_permission_grants", ["user_id"], unique=False
    )

    op.create_table(
        "user_department_scope",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("department_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_department_scope_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["departments.id"],
            name=op.f("fk_user_department_scope_department_id_departments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "department_id", name=op.f("pk_user_department_scope")),
    )

    bind = op.get_bind()

    # 1) Every non-SUPER_ADMIN, non-CANDIDATE, non-RECRUITMENT_COORDINATOR
    # user gets their role's default permission set.
    total_default_grants = 0
    for role, permissions in _DEFAULT_PERMISSIONS_BY_ROLE.items():
        user_ids = [
            row[0]
            for row in bind.execute(
                sa.text("SELECT id FROM users WHERE role = :role"), {"role": role}
            ).fetchall()
        ]
        for permission in permissions:
            if not user_ids:
                continue
            result = bind.execute(
                sa.text(
                    """
                    INSERT INTO user_permission_grants (user_id, permission)
                    SELECT u.id, CAST(:permission AS permission_enum)
                    FROM users u
                    WHERE u.role = :role
                    ON CONFLICT (user_id, permission) DO NOTHING
                    """
                ),
                {"role": role, "permission": permission},
            )
            total_default_grants += result.rowcount or 0

    # 2) RECRUITMENT_COORDINATOR: baseline + real current CoordinatorCapabilityGrant
    # rows mapped onto the new granular permissions, preserving each real
    # coordinator's actual current effective access exactly.
    coordinator_grants = 0
    coordinator_ids = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM users WHERE role = 'RECRUITMENT_COORDINATOR'")
        ).fetchall()
    ]
    for permission in _COORDINATOR_BASELINE:
        result = bind.execute(
            sa.text(
                """
                INSERT INTO user_permission_grants (user_id, permission)
                SELECT u.id, CAST(:permission AS permission_enum)
                FROM users u
                WHERE u.role = 'RECRUITMENT_COORDINATOR'
                ON CONFLICT (user_id, permission) DO NOTHING
                """
            ),
            {"permission": permission},
        )
        coordinator_grants += result.rowcount or 0

    for capability, permissions in _CAPABILITY_TO_PERMISSIONS.items():
        for permission in permissions:
            result = bind.execute(
                sa.text(
                    """
                    INSERT INTO user_permission_grants (user_id, permission)
                    SELECT ccg.user_id, CAST(:permission AS permission_enum)
                    FROM coordinator_capability_grants ccg
                    WHERE ccg.capability = :capability
                    ON CONFLICT (user_id, permission) DO NOTHING
                    """
                ),
                {"capability": capability, "permission": permission},
            )
            coordinator_grants += result.rowcount or 0

    # 3) Preserve current single-department scope as the starting point of
    # the new multi-department table.
    dept_scope_result = bind.execute(
        sa.text(
            """
            INSERT INTO user_department_scope (user_id, department_id)
            SELECT id, department_id FROM users WHERE department_id IS NOT NULL
            ON CONFLICT (user_id, department_id) DO NOTHING
            """
        )
    )
    dept_scope_rows = dept_scope_result.rowcount or 0

    total_coordinators = len(coordinator_ids)
    print(
        f"[{revision}] backfill: {total_default_grants} default-role grant row(s), "
        f"{coordinator_grants} RECRUITMENT_COORDINATOR grant row(s) across {total_coordinators} "
        f"coordinator(s), {dept_scope_rows} user_department_scope row(s)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_department_scope")
    op.drop_index(op.f("ix_user_permission_grants_user_id"), table_name="user_permission_grants")
    op.drop_table("user_permission_grants")
    postgresql.ENUM(name="permission_enum").drop(op.get_bind(), checkfirst=True)
