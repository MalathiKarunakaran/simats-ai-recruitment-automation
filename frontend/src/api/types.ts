// Mirrors app/models/enums.py::UserRoleEnum. Keep in sync with the backend.
export type UserRole =
  | "SUPER_ADMIN"
  | "HR_ADMIN"
  | "ASSOCIATE_DEAN_RECRUITMENT"
  | "RECRUITMENT_OFFICER"
  | "CAMPUS_HOD"
  | "INTERVIEW_PANEL_MEMBER"
  | "MANAGEMENT"
  | "CANDIDATE";

// Mirrors app/models/enums.py::GLOBAL_SCOPE_ROLES -- roles that see all
// campuses and can narrow via a campus_code query param.
export const GLOBAL_SCOPE_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "ASSOCIATE_DEAN_RECRUITMENT",
  "MANAGEMENT",
];

// Mirrors app/models/enums.py::CAMPUS_CODES exactly -- institutional codes,
// never renamed/reformatted.
export const CAMPUS_CODES = ["SSE", "SCLAS", "SCAD", "STUDIO", "SPIER", "SHOTS", "SSPE"] as const;
export type CampusCode = (typeof CAMPUS_CODES)[number];

// Mirrors app/schemas/token.py::TokenPair.
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// Mirrors app/schemas/user.py::UserRead.
export interface UserRead {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  campus_id: string | null;
  department_id: string | null;
  is_active: boolean;
  is_email_verified: boolean;
  phone_number: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/common.py::PaginatedResponse.
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Mirrors app/schemas/campus.py::CampusRead.
export interface CampusRead {
  id: string;
  code: CampusCode;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/dashboard-shaped response from app/services/reporting.py::get_dashboard_kpis.
export interface CampusHiringRow {
  campus_code: string;
  hired_count: number;
}

export interface DashboardKpis {
  scope_note: string;
  total_applications: number;
  open_positions: number;
  interviews_today: number;
  joinings_today: number;
  offers_pending: number;
  campus_wise_hiring: CampusHiringRow[];
  average_time_to_hire_days: number | null;
  vacancy_closure_rate_pct: number;
}

// Mirrors app/schemas/department.py::DepartmentRead.
export interface DepartmentRead {
  id: string;
  campus_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/models/enums.py::VacancyRequestStatusEnum.
export type VacancyRequestStatus = "DRAFT" | "SUBMITTED" | "DEAN_APPROVED" | "APPROVED" | "PUBLISHED" | "CLOSED" | "REJECTED";

// Mirrors app/models/enums.py::EmploymentTypeEnum.
export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "VISITING";

// Mirrors app/models/enums.py::VacancyPriorityEnum.
export type VacancyPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

// Mirrors app/models/enums.py::StaffRoleCategoryEnum.
export type StaffRoleCategory = "TEACHING" | "NON_TEACHING" | "HOUSEKEEPING";

// Mirrors app/schemas/vacancy_request.py::VacancyRequestRead.
export interface VacancyRequestRead {
  id: string;
  campus_id: string;
  department_id: string;
  role_category: StaffRoleCategory;
  position_title: string;
  employment_type: EmploymentType;
  requested_count: number;
  qualification: string;
  experience_required: string;
  salary_band_min: number | null;
  salary_band_max: number | null;
  jd_draft: string | null;
  skills: string[] | null;
  priority: VacancyPriority;
  status: VacancyRequestStatus;
  requested_by_id: string;
  submitted_at: string | null;
  dean_reviewed_by_id: string | null;
  dean_reviewed_at: string | null;
  hr_reviewed_by_id: string | null;
  hr_reviewed_at: string | null;
  rejected_by_id: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/vacancy_request.py::VacancyRequestCreate. Also reused
// (all fields optional) as the PATCH payload shape for edits.
export interface VacancyRequestCreatePayload {
  campus_id: string;
  department_id: string;
  role_category: StaffRoleCategory;
  position_title: string;
  employment_type: EmploymentType;
  requested_count: number;
  qualification: string;
  experience_required: string;
  salary_band_min?: number | null;
  salary_band_max?: number | null;
  skills?: string[] | null;
  priority?: VacancyPriority;
}

export type VacancyRequestUpdatePayload = Partial<Omit<VacancyRequestCreatePayload, "campus_id" | "department_id">>;

// Mirrors app/schemas/approved_vacancy.py::ApprovedVacancyRead.
export interface ApprovedVacancyRead {
  id: string;
  vacancy_request_id: string;
  campus_id: string;
  total_positions: number;
  approved_by_id: string;
  approved_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/job_posting.py::JobPostingRead.
export interface JobPostingRead {
  id: string;
  approved_vacancy_id: string;
  campus_id: string;
  public_apply_slug: string;
  published_at: string;
  closed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/models/enums.py::ApplicationStatusEnum.
export type ApplicationStatus =
  | "APPLIED"
  | "SCREENING"
  | "ELIGIBLE"
  | "SHORTLISTED"
  | "INTERVIEW_SCHEDULED"
  | "TECHNICAL_INTERVIEW"
  | "HR_INTERVIEW"
  | "SELECTED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED"
  | "JOINING_PENDING"
  | "JOINED"
  | "ONBOARDING_COMPLETE"
  | "EMPLOYEE_CREATED"
  | "REJECTED";

// Mirrors app/models/enums.py::APPLICATION_STATUS_ORDER -- forward-progression
// order for the happy-path pipeline. REJECTED is deliberately excluded, same
// as the backend: it's reachable from any non-terminal status, not just a
// linear predecessor.
export const APPLICATION_STATUS_ORDER: readonly ApplicationStatus[] = [
  "APPLIED",
  "SCREENING",
  "ELIGIBLE",
  "SHORTLISTED",
  "INTERVIEW_SCHEDULED",
  "TECHNICAL_INTERVIEW",
  "HR_INTERVIEW",
  "SELECTED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "JOINING_PENDING",
  "JOINED",
  "ONBOARDING_COMPLETE",
  "EMPLOYEE_CREATED",
];

// Mirrors app/models/enums.py::APPLICATION_TERMINAL_STATUSES.
export const APPLICATION_TERMINAL_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "EMPLOYEE_CREATED",
  "REJECTED",
]);

// Mirrors app/schemas/application.py::ApplicationRead.
export interface ApplicationRead {
  id: string;
  candidate_id: string;
  job_posting_id: string;
  campus_id: string;
  status: ApplicationStatus;
  applied_at: string;
  recorded_by_id: string;
  rejection_reason: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/application.py::ApplicationCreate.
export interface ApplicationCreatePayload {
  candidate_id: string;
  job_posting_id: string;
}

// Mirrors app/schemas/application.py::ApplicationStatusTransitionRequest.
export interface ApplicationStatusTransitionPayload {
  status: ApplicationStatus;
  reason?: string | null;
  force?: boolean;
}

// Mirrors app/schemas/candidate.py::CandidateRead.
export interface CandidateRead {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  resume_storage_key: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/candidate.py::CandidateCreate.
export interface CandidateCreatePayload {
  full_name: string;
  email: string;
  phone_number?: string | null;
  source?: string | null;
}
