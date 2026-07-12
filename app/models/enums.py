import enum


class UserRoleEnum(str, enum.Enum):
    """User *access* role (RBAC). Stored as a native Postgres ENUM (user_role_enum).

    Deliberately distinct from the future Phase 2 staff `role_category` concept
    (Teaching / Non-Teaching / Housekeeping) used on Vacancy-related tables --
    that's "what kind of staff position is this hiring for", not "who can log
    in and do what". Do not conflate the two enums.
    """

    SUPER_ADMIN = "SUPER_ADMIN"
    HR_ADMIN = "HR_ADMIN"
    ASSOCIATE_DEAN_RECRUITMENT = "ASSOCIATE_DEAN_RECRUITMENT"
    RECRUITMENT_OFFICER = "RECRUITMENT_OFFICER"
    CAMPUS_HOD = "CAMPUS_HOD"
    INTERVIEW_PANEL_MEMBER = "INTERVIEW_PANEL_MEMBER"
    MANAGEMENT = "MANAGEMENT"
    CANDIDATE = "CANDIDATE"


# Roles with organization-wide (all-campus) visibility by default.
GLOBAL_SCOPE_ROLES = {
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
    UserRoleEnum.MANAGEMENT,
}

# Roles that are scoped to a single home campus (documented Phase 1 assumption
# for the roles the master spec didn't fully pin down: RECRUITMENT_OFFICER and
# INTERVIEW_PANEL_MEMBER).
SINGLE_CAMPUS_SCOPE_ROLES = {
    UserRoleEnum.CAMPUS_HOD,
    UserRoleEnum.RECRUITMENT_OFFICER,
    UserRoleEnum.INTERVIEW_PANEL_MEMBER,
}

# Roles allowed to create/update/deactivate other users in Phase 1.
USER_MANAGEMENT_ROLES = {
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.HR_ADMIN,
}

# The 7 institutional campus codes -- preserved exactly, never renamed/reformatted.
CAMPUS_CODES: tuple[str, ...] = (
    "SSE",
    "SCLAS",
    "SCAD",
    "STUDIO",
    "SPIER",
    "SHOTS",
    "SSPE",
)
