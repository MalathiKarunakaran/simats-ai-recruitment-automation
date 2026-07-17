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


class VacancyPriorityEnum(str, enum.Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"


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
VACANCY_APPROVAL_HR_ROLES = {UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN}
VACANCY_REJECT_ROLES = {
    UserRoleEnum.ASSOCIATE_DEAN_RECRUITMENT,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
}
RECRUITMENT_WRITE_ROLES = {
    UserRoleEnum.RECRUITMENT_OFFICER,
    UserRoleEnum.HR_ADMIN,
    UserRoleEnum.SUPER_ADMIN,
}
HR_WRITE_ROLES = {UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN}


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
