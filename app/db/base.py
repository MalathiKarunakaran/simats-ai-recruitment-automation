"""Import every model module so Base.metadata is fully populated for Alembic autogenerate."""

from app.db.base_class import Base
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.auth_token import PasswordResetToken, RefreshToken  # noqa: F401
from app.models.campus import Campus  # noqa: F401
from app.models.department import Department  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.coordinator_capability_grant import CoordinatorCapabilityGrant  # noqa: F401

from app.models.vacancy_request import VacancyRequest  # noqa: F401
from app.models.approved_vacancy import ApprovedVacancy  # noqa: F401
from app.models.job_posting import JobPosting  # noqa: F401
from app.models.candidate import Candidate  # noqa: F401
from app.models.application import Application  # noqa: F401
from app.models.hiring_slot import HiringSlot  # noqa: F401
from app.models.offer import Offer  # noqa: F401
from app.models.joining import JoiningDocument, JoiningRecord  # noqa: F401
from app.models.employee import Employee  # noqa: F401

from app.models.resume_score import ResumeScore  # noqa: F401
from app.models.interview import InterviewFeedback, InterviewPanelAssignment, InterviewSchedule  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.eligibility_rule import EligibilityRule  # noqa: F401

__all__ = ["Base"]
