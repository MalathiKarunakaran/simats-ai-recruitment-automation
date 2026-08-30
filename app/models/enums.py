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
    RECRUITMENT_COORDINATOR = "RECRUITMENT_COORDINATOR"
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
    UserRoleEnum.RECRUITMENT_COORDINATOR,
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
# SHIFT was added 2026-08-06, confirmed by the user as a real campus/college (not a
# typo) -- this closes the "8 campuses, only 7 ever named" gap documented in
# RTCFR Prompt.docx / CLAUDE.md's "Source spec" section. SHOTS was removed the
# same day -- the user confirmed it was a duplicate of SHIFT, not a distinct
# campus (net still 7 codes, just a different 7 than the original seed set).
CAMPUS_CODES: tuple[str, ...] = (
    "SSE",
    "SCLAS",
    "SCAD",
    "STUDIO",
    "SPIER",
    "SSPE",
    "SHIFT",
)


class StaffRoleCategoryEnum(str, enum.Enum):
    """What kind of staff position a vacancy is hiring for. Deliberately a
    separate enum from UserRoleEnum (see the warning on that class) -- this
    is never used to gate API access."""

    TEACHING = "TEACHING"
    NON_TEACHING = "NON_TEACHING"
    HOUSEKEEPING = "HOUSEKEEPING"


class EmploymentTypeEnum(str, enum.Enum):
    FULL_TIME = "FULL_TIME"
    PART_TIME = "PART_TIME"
    CONTRACT = "CONTRACT"
    VISITING = "VISITING"
    # Added for the Designation Master rollout (Phase 10) -- see
    # alembic/versions/56d04b40220a_phase10_designation_master.py.
    ADJUNCT = "ADJUNCT"
    # Teaching Research Assistant / Junior Research Fellow -- see
    # alembic/versions/4a7c9e1f2b3d_add_tra_jrf_employment_types.py.
    TRA = "TRA"
    JRF = "JRF"


class EmploymentStatusEnum(str, enum.Enum):
    """Current employment status of an Employee record. Doubles as the
    separation-type vocabulary once an employee is offboarded (RESIGNED /
    TERMINATED / RETIRED) -- no separate "separation type" enum needed since
    the two concepts never diverge (an employee's status *is* how they left)."""

    ACTIVE = "ACTIVE"
    RESIGNED = "RESIGNED"
    TERMINATED = "TERMINATED"
    RETIRED = "RETIRED"


class VacancyPriorityEnum(str, enum.Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"


class VacancyRequestSourceEnum(str, enum.Enum):
    """How a VacancyRequest got into the system (2026-08-30).

    MANUAL is the pre-existing in-app requisition flow and is the migration's
    `server_default`, so every row created before this column existed
    backfills correctly with no data migration.

    QR marks a submission from the public, unauthenticated intake form. Those
    rows are the reason `requester_name`/`requester_email`/`requester_mobile`
    exist on the model: there is no internal `User` behind them, so the
    requester's own details have nowhere else to live.

    This is a NEW native Postgres enum type, not an `ALTER TYPE ... ADD VALUE`
    on an existing one -- so unlike `BulkUploadEntityTypeEnum`, labels here
    can still be changed cleanly while the type is young.
    """

    MANUAL = "MANUAL"
    BULK_UPLOAD = "BULK_UPLOAD"
    QR = "QR"


class VacancyRequestStatusEnum(str, enum.Enum):
    """DEAN_APPROVED is an added intermediate state (not one of the master
    spec's 6 literal status names) needed to distinguish "Dean approved,
    awaiting HR" from the spec's single "Approved" -- which maps to HR's
    *final* approval, the moment ApprovedVacancy + HiringSlots are created.
    """

    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    DEAN_APPROVED = "DEAN_APPROVED"
    APPROVED = "APPROVED"
    PUBLISHED = "PUBLISHED"
    CLOSED = "CLOSED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


# The VacancyRequest statuses that reserve against a (campus, department,
# designation)'s Sanctioned Strength ceiling (zany-snuggling-pie.md's
# Context section, decision 2 / Phase E's `available_to_request` formula):
# `available_to_request = approved_strength - working_count -
# SUM(requested_count WHERE status IN (...))`. DRAFT reserves nothing (the
# block is enforced at submit(), not draft creation); CLOSED/REJECTED/
# CANCELLED are terminal and drop out automatically the moment they're
# reached, which is what makes "release on terminal" a live-query side
# effect rather than a separate stored reservation to release. Shared by
# app/services/vacancy_register.py's recruitment_status_request_count,
# app/services/sanctioned_strength.py's availability computation, and
# app/services/vacancy_workflow.py's submit()-time enforcement -- one
# definition, reused everywhere, not reimplemented per call site.
VACANCY_REQUEST_IN_FLIGHT_STATUSES = (
    VacancyRequestStatusEnum.SUBMITTED,
    VacancyRequestStatusEnum.DEAN_APPROVED,
    VacancyRequestStatusEnum.APPROVED,
    VacancyRequestStatusEnum.PUBLISHED,
)


class HiringSlotStatusEnum(str, enum.Enum):
    OPEN = "OPEN"
    RESERVED = "RESERVED"
    FILLED = "FILLED"


class ApplicationStatusEnum(str, enum.Enum):
    """Mirrors the real, currently-manual SIMATS hiring sequence (not a
    generic ATS pipeline): sourcing/shortlisting is manual, a department
    panel interviews and fixes salary, and joining is followed by three
    separate, real hand-tracked stages -- department/room allotment,
    orientation, and handover to the department HOD -- rather than one
    collapsed "onboarding complete" step.

    The underlying Postgres native enum (application_status_enum) still
    physically contains the old, pre-rename labels (ELIGIBLE, SHORTLISTED,
    INTERVIEW_SCHEDULED, TECHNICAL_INTERVIEW, HR_INTERVIEW, JOINING_PENDING,
    ONBOARDING_COMPLETE, EMPLOYEE_CREATED) -- Postgres has no ALTER TYPE ...
    DROP VALUE, so they can't be removed. They're simply never written again;
    see the migration that renamed this pipeline for the old-to-new mapping.
    """

    APPLIED = "APPLIED"
    SCREENING = "SCREENING"
    CALLED_FOR_INTERVIEW = "CALLED_FOR_INTERVIEW"
    INTERVIEWED = "INTERVIEWED"
    SELECTED = "SELECTED"
    OFFER_SENT = "OFFER_SENT"
    OFFER_ACCEPTED = "OFFER_ACCEPTED"
    JOINING_CONFIRMED = "JOINING_CONFIRMED"
    JOINED = "JOINED"
    DEPARTMENT_ROOM_ALLOTTED = "DEPARTMENT_ROOM_ALLOTTED"
    ORIENTATION_COMPLETE = "ORIENTATION_COMPLETE"
    HANDED_OVER_TO_HOD = "HANDED_OVER_TO_HOD"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"


# Forward-progression order for the happy-path pipeline. REJECTED is
# deliberately excluded -- it's reachable from any non-terminal status, not
# just the one before it, so it isn't part of this linear ordering.
APPLICATION_STATUS_ORDER: tuple[ApplicationStatusEnum, ...] = (
    ApplicationStatusEnum.APPLIED,
    ApplicationStatusEnum.SCREENING,
    ApplicationStatusEnum.CALLED_FOR_INTERVIEW,
    ApplicationStatusEnum.INTERVIEWED,
    ApplicationStatusEnum.SELECTED,
    ApplicationStatusEnum.OFFER_SENT,
    ApplicationStatusEnum.OFFER_ACCEPTED,
    ApplicationStatusEnum.JOINING_CONFIRMED,
    ApplicationStatusEnum.JOINED,
    ApplicationStatusEnum.DEPARTMENT_ROOM_ALLOTTED,
    ApplicationStatusEnum.ORIENTATION_COMPLETE,
    ApplicationStatusEnum.HANDED_OVER_TO_HOD,
)

APPLICATION_TERMINAL_STATUSES = {
    ApplicationStatusEnum.HANDED_OVER_TO_HOD,
    ApplicationStatusEnum.REJECTED,
    ApplicationStatusEnum.WITHDRAWN,
}


class OfferStatusEnum(str, enum.Enum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    WITHDRAWN = "WITHDRAWN"


class JoiningDocumentStatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    RECEIVED = "RECEIVED"


# Plain strings, not a DB enum, on JoiningDocument.document_type -- this
# checklist will plausibly grow (e.g. police verification, medical fitness)
# and a DB ENUM would need a migration per addition. This tuple just seeds
# the default checklist.
DEFAULT_JOINING_DOCUMENT_TYPES: tuple[str, ...] = (
    "DEGREE_CERTIFICATE",
    "EXPERIENCE_CERTIFICATE",
    "PAN",
    "AADHAAR",
    "PHOTO",
    "BANK_DETAILS",
)

# Approval-chain and write-access role groupings for Phase 2 routers.
VACANCY_APPROVAL_DEAN_ROLES = {UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT, UserRoleEnum.SUPER_ADMIN}
VACANCY_APPROVAL_HR_ROLES = {
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
}
VACANCY_REJECT_ROLES = {
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
}
RECRUITMENT_WRITE_ROLES = {
    UserRoleEnum.RECRUITMENT_OFFICER,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
}
HR_WRITE_ROLES = {
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
}

# Designation Master write access -- a new, deliberately narrower pairing
# than HR_WRITE_ROLES/RECRUITMENT_WRITE_ROLES above (does NOT include
# HR_ADMIN or RECRUITMENT_OFFICER).
DESIGNATION_WRITE_ROLES = {
    UserRoleEnum.SUPER_ADMIN,
    UserRoleEnum.RECRUITMENT_COORDINATOR,
}

# Sanctioned Strength write access (zany-snuggling-pie.md Phase A) -- the
# permanent establishment record is editable only by these two roles, unlike
# the broader VacancyRequest workflow roles above. Same shape as
# app/api/v1/routers/departments.py's own _WRITE_ROLES.
SANCTIONED_STRENGTH_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)


class SanctionedStrengthChangeSourceEnum(str, enum.Enum):
    """How a SanctionedStrengthHistory row came to exist -- MANUAL for the
    Phase B CRUD endpoints, BULK_UPLOAD for Phase F's upload commit (which
    additionally stamps SanctionedStrengthHistory.bulk_upload_log_id)."""

    MANUAL = "MANUAL"
    BULK_UPLOAD = "BULK_UPLOAD"


class BulkUploadStatusEnum(str, enum.Enum):
    """Lifecycle of a single Sanctioned Strength bulk-upload batch (Phase F)
    -- COMPLETED until/unless undone within the 24h window."""

    COMPLETED = "COMPLETED"
    UNDONE = "UNDONE"


class BulkUploadEntityTypeEnum(str, enum.Enum):
    """Which entity a `BulkUploadLog` row's batch imported (Phase J,
    glowing-zooming-hamming.md) -- `BulkUploadLog.entity_type` discriminates
    the 4 shared endpoints (list/error-report/original-file/undo) so they can
    dispatch to the right service module (`sanctioned_strength_import.py`/
    `location_import.py`/`housekeeping_staff_import.py`/
    `department_import.py`) without near-duplicate endpoint families.
    SANCTIONED_STRENGTH is the pre-existing Phase F behavior, preserved as
    the migration's `server_default` so every existing row backfills
    correctly with zero manual data migration. DEPARTMENT was added later
    (Department Master hardening epic, 2026-08-25) via `ALTER TYPE ... ADD
    VALUE` on this already-live native enum -- see
    f7c1a2b3d4e5_bulk_upload_department_entity_type.py for why that means
    the label can never be cleanly removed again."""

    SANCTIONED_STRENGTH = "SANCTIONED_STRENGTH"
    LOCATION = "LOCATION"
    HOUSEKEEPING_STAFF = "HOUSEKEEPING_STAFF"
    DEPARTMENT = "DEPARTMENT"
    # Added for the starter regulatory-eligibility-rules feature (backend
    # Phase 1) via `ALTER TYPE ... ADD VALUE` on this already-live native
    # enum -- see the migration adding EligibilityRule bulk upload for why
    # that means this label can never be cleanly removed again.
    ELIGIBILITY_RULE = "ELIGIBILITY_RULE"
    # Added for the Designation Master bulk-upload epic (backend Phase 1) via
    # `ALTER TYPE ... ADD VALUE` on this already-live native enum -- see
    # d8e9f0a1b2c3_designation_required_skills_bulk_upload.py for why that
    # means this label can never be cleanly removed again.
    DESIGNATION = "DESIGNATION"
    # Added 2026-08-30 via `ALTER TYPE ... ADD VALUE` (migration
    # c9d0e1f2a3b4) -- same never-cleanly-removable caveat as the three above.
    #
    # The odd one out in this list: every other member is MASTER DATA, where a
    # re-upload legitimately upserts an existing record. A vacancy request is
    # an EVENT -- two identical rows are two genuine requests, not a duplicate
    # -- so its importer is create-only and never reports `updated` or
    # `unchanged`. See app/services/vacancy_request_import.py.
    VACANCY_REQUEST = "VACANCY_REQUEST"


class RegulatoryAuthorityEnum(str, enum.Enum):
    """Which regulatory body's minimum-qualification rules an EligibilityRule
    row maps to (starter regulatory-eligibility-rules feature, backend Phase
    1). Deliberately a fixed, small vocabulary -- these are the specific
    authorities SIMATS's own programmes map to, not a general lookup table.
    UGC_AICTE_INSTITUTION is the genuinely-ambiguous Design case ("determine
    per programme, not automatically AICTE"). UNMAPPED_VERIFY is for
    campuses/departments where no authority could safely be determined yet
    (e.g. Hospitality/Aviation/Tourism programmes) -- a real, honest "not yet
    mapped" value rather than guessing."""

    AICTE_UGC = "AICTE_UGC"
    COA = "COA"
    UGC = "UGC"
    UGC_AICTE_INSTITUTION = "UGC_AICTE_INSTITUTION"
    NCTE_UGC = "NCTE_UGC"
    INSTITUTION_NON_TEACHING = "INSTITUTION_NON_TEACHING"
    INSTITUTION_HR_HOUSEKEEPING = "INSTITUTION_HR_HOUSEKEEPING"
    UNMAPPED_VERIFY = "UNMAPPED_VERIFY"


class EligibilityRuleStatusEnum(str, enum.Enum):
    """Admin-facing display/workflow status for an EligibilityRule row
    (starter regulatory-eligibility-rules feature, backend Phase 1) --
    deliberately independent of the pre-existing `is_active` boolean, which
    remains the ONLY field `app/services/eligibility.py`'s live
    `check_qualification_mismatch` filters on. `status` exists purely so a
    rule can visibly read "Draft"/"Archived" in the admin UI without needing
    to infer that from `is_active` alone."""

    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class HousekeepingShiftEnum(str, enum.Enum):
    """Which shift a Housekeeping staff roster entry (Phase D,
    glowing-zooming-hamming.md) is assigned to. A small, bounded, unlikely-
    to-change vocabulary -- matches this codebase's existing enum-heavy
    convention (native Postgres ENUM, same as StaffRoleCategoryEnum/
    EmploymentTypeEnum/etc.) rather than a free-text column, per the plan's
    "Lower-stakes design defaults" section. Unlike `supervisor` (genuinely
    free text -- no self-referential-FK precedent anywhere in this codebase),
    shift has a real fixed set of values worth enforcing at the DB level."""

    MORNING = "MORNING"
    AFTERNOON = "AFTERNOON"
    EVENING = "EVENING"
    NIGHT = "NIGHT"


class CoordinatorCapabilityEnum(str, enum.Enum):
    """Per-user, Super-Admin-granted capabilities for RECRUITMENT_COORDINATOR
    only. Unlike every other role's access (a fixed set of endpoints gated by
    role membership alone), a coordinator's write access to these four action
    groups is additionally conditional on a CoordinatorCapabilityGrant row
    existing for (user, capability) -- see
    app.core.deps.require_roles_or_coordinator_capability. Deliberately not a
    generic multi-role permission system: every other role keeps unconditional
    role-based access to these same endpoints."""

    VACANCY_APPROVAL = "VACANCY_APPROVAL"
    CANDIDATES_APPLICATIONS = "CANDIDATES_APPLICATIONS"
    INTERVIEWS = "INTERVIEWS"
    JOB_DISTRIBUTION_SCREENING = "JOB_DISTRIBUTION_SCREENING"


class PermissionEnum(str, enum.Enum):
    """Granular permission matrix -- Phase 1 (schema + services only) of the
    epic that will eventually replace CoordinatorCapabilityEnum's 4-value,
    RECRUITMENT_COORDINATOR-only scheme with a 31-permission matrix usable by
    any role. Deliberately additive: CoordinatorCapabilityEnum and
    CoordinatorCapabilityGrant stay exactly as-is and fully wired until a
    later phase cuts routers over and retires them. Not yet consulted by any
    router -- see app.services.permissions.has_permission."""

    # Vacancy Management (8)
    VIEW_VACANCY = "VIEW_VACANCY"
    CREATE_VACANCY_REQUEST = "CREATE_VACANCY_REQUEST"
    EDIT_VACANCY_REQUEST = "EDIT_VACANCY_REQUEST"
    APPROVE_VACANCY = "APPROVE_VACANCY"
    REJECT_VACANCY = "REJECT_VACANCY"
    PUBLISH_VACANCY = "PUBLISH_VACANCY"
    CLOSE_VACANCY = "CLOSE_VACANCY"
    CANCEL_VACANCY = "CANCEL_VACANCY"
    # Candidates (5)
    VIEW_CANDIDATES = "VIEW_CANDIDATES"
    CREATE_CANDIDATE = "CREATE_CANDIDATE"
    EDIT_CANDIDATE = "EDIT_CANDIDATE"
    DELETE_CANDIDATE = "DELETE_CANDIDATE"
    MANAGE_APPLICATIONS = "MANAGE_APPLICATIONS"
    # Interviews (4)
    SCHEDULE_INTERVIEW = "SCHEDULE_INTERVIEW"
    RESCHEDULE_INTERVIEW = "RESCHEDULE_INTERVIEW"
    CANCEL_INTERVIEW = "CANCEL_INTERVIEW"
    MARK_INTERVIEW_COMPLETED = "MARK_INTERVIEW_COMPLETED"
    # Recruitment (4)
    JOB_DISTRIBUTION = "JOB_DISTRIBUTION"
    RESUME_SCREENING = "RESUME_SCREENING"
    OFFERS = "OFFERS"
    ONBOARDING = "ONBOARDING"
    # Administration (7)
    VIEW_EMPLOYEES = "VIEW_EMPLOYEES"
    EDIT_EMPLOYEES = "EDIT_EMPLOYEES"
    MANAGE_DEPARTMENTS = "MANAGE_DEPARTMENTS"
    MANAGE_DESIGNATIONS = "MANAGE_DESIGNATIONS"
    MANAGE_LOCATIONS = "MANAGE_LOCATIONS"
    MANAGE_CAMPUSES = "MANAGE_CAMPUSES"
    MANAGE_USERS = "MANAGE_USERS"
    # System (3)
    ACTIVITY_LOG = "ACTIVITY_LOG"
    REPORTS = "REPORTS"
    SETTINGS = "SETTINGS"


# Frontend permission-matrix grouping (Phase 3) -- lives here once, centrally,
# rather than being re-derived from naming conventions at render time.
PERMISSION_CATEGORIES: dict[str, list[PermissionEnum]] = {
    "VACANCY_MANAGEMENT": [
        PermissionEnum.VIEW_VACANCY,
        PermissionEnum.CREATE_VACANCY_REQUEST,
        PermissionEnum.EDIT_VACANCY_REQUEST,
        PermissionEnum.APPROVE_VACANCY,
        PermissionEnum.REJECT_VACANCY,
        PermissionEnum.PUBLISH_VACANCY,
        PermissionEnum.CLOSE_VACANCY,
        PermissionEnum.CANCEL_VACANCY,
    ],
    "CANDIDATES": [
        PermissionEnum.VIEW_CANDIDATES,
        PermissionEnum.CREATE_CANDIDATE,
        PermissionEnum.EDIT_CANDIDATE,
        PermissionEnum.DELETE_CANDIDATE,
        PermissionEnum.MANAGE_APPLICATIONS,
    ],
    "INTERVIEWS": [
        PermissionEnum.SCHEDULE_INTERVIEW,
        PermissionEnum.RESCHEDULE_INTERVIEW,
        PermissionEnum.CANCEL_INTERVIEW,
        PermissionEnum.MARK_INTERVIEW_COMPLETED,
    ],
    "RECRUITMENT": [
        PermissionEnum.JOB_DISTRIBUTION,
        PermissionEnum.RESUME_SCREENING,
        PermissionEnum.OFFERS,
        PermissionEnum.ONBOARDING,
    ],
    "ADMINISTRATION": [
        PermissionEnum.VIEW_EMPLOYEES,
        PermissionEnum.EDIT_EMPLOYEES,
        PermissionEnum.MANAGE_DEPARTMENTS,
        PermissionEnum.MANAGE_DESIGNATIONS,
        PermissionEnum.MANAGE_LOCATIONS,
        PermissionEnum.MANAGE_CAMPUSES,
        PermissionEnum.MANAGE_USERS,
    ],
    "SYSTEM": [
        PermissionEnum.ACTIVITY_LOG,
        PermissionEnum.REPORTS,
        PermissionEnum.SETTINGS,
    ],
}


class InterviewTypeEnum(str, enum.Enum):
    TECHNICAL = "TECHNICAL"
    HR = "HR"
    TEACHING_DEMO = "TEACHING_DEMO"
    GENERAL = "GENERAL"


class InterviewScheduleStatusEnum(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    RESCHEDULED = "RESCHEDULED"


class InterviewRecommendationEnum(str, enum.Enum):
    STRONG_HIRE = "STRONG_HIRE"
    HIRE = "HIRE"
    NO_HIRE = "NO_HIRE"
    STRONG_NO_HIRE = "STRONG_NO_HIRE"




class NotificationChannelEnum(str, enum.Enum):
    """Small, stable set of transport mechanisms -- unlike notification_type
    (see Notification model), this rarely changes, so it's a real enum."""

    EMAIL = "EMAIL"
    TELEGRAM = "TELEGRAM"
    SMS = "SMS"
    WHATSAPP = "WHATSAPP"


class NotificationStatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"
