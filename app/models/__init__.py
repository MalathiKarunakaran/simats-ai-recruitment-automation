"""Import every model module so SQLAlchemy's mapper registry can resolve
string-based relationship() references regardless of which module is
imported first (e.g. a script that only imports `User` directly)."""

from app.models.audit_log import AuditLog  # noqa: F401
from app.models.auth_token import PasswordResetToken, RefreshToken  # noqa: F401
from app.models.campus import Campus  # noqa: F401
from app.models.department import Department  # noqa: F401
from app.models.user import User  # noqa: F401

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
