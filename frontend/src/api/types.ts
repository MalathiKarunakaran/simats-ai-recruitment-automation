// Mirrors app/models/enums.py::UserRoleEnum. Keep in sync with the backend.
export type UserRole =
  | "SUPER_ADMIN"
  | "HR_ADMIN"
  | "ASSOCIATE_DEAN_RECRUITMENT"
  | "RECRUITMENT_OFFICER"
  | "CAMPUS_HOD"
  | "INTERVIEW_PANEL_MEMBER"
  | "MANAGEMENT"
  | "CANDIDATE"
  | "RECRUITMENT_COORDINATOR";

// Mirrors app/models/enums.py::GLOBAL_SCOPE_ROLES -- roles that see all
// campuses and can narrow via a campus_code query param.
export const GLOBAL_SCOPE_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "ASSOCIATE_DEAN_RECRUITMENT",
  "MANAGEMENT",
  "RECRUITMENT_COORDINATOR",
];

// Mirrors app/models/enums.py::SINGLE_CAMPUS_SCOPE_ROLES -- roles that must
// be pinned to one home campus.
export const SINGLE_CAMPUS_SCOPE_ROLES: readonly UserRole[] = [
  "CAMPUS_HOD",
  "RECRUITMENT_OFFICER",
  "INTERVIEW_PANEL_MEMBER",
];

// Mirrors app/models/enums.py::USER_MANAGEMENT_ROLES -- roles allowed to
// create/update/deactivate other users.
export const USER_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN"];

// Mirrors app/api/v1/routers/eligibility_rules.py's write-role gate --
// roles allowed to create/update eligibility rules (reads are staff-only,
// same as departments).
export const ELIGIBILITY_RULE_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN"];

// Every staff-assignable role -- excludes CANDIDATE, which is never created
// through the admin Users UI (candidates are tracked via the separate
// Candidate model, not a login-capable User).
export const ASSIGNABLE_STAFF_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "ASSOCIATE_DEAN_RECRUITMENT",
  "RECRUITMENT_OFFICER",
  "CAMPUS_HOD",
  "INTERVIEW_PANEL_MEMBER",
  "MANAGEMENT",
  "RECRUITMENT_COORDINATOR",
];

// Mirrors app/models/enums.py::CAMPUS_CODES exactly -- institutional codes,
// never renamed/reformatted. SHIFT added 2026-08-06 (confirmed real, not a
// typo); SHOTS removed the same day (confirmed a duplicate of SHIFT).
export const CAMPUS_CODES = ["SSE", "SCLAS", "SCAD", "STUDIO", "SPIER", "SSPE", "SHIFT"] as const;
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

// Mirrors app/schemas/user.py::UserCreate.
export interface UserCreatePayload {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
  campus_id?: string | null;
  department_id?: string | null;
  phone_number?: string | null;
}

// Mirrors app/schemas/user.py::UserUpdate.
export interface UserUpdatePayload {
  full_name?: string;
  role?: UserRole;
  campus_id?: string | null;
  department_id?: string | null;
  phone_number?: string | null;
  is_active?: boolean;
}

// Mirrors app/schemas/user.py::UserSelfUpdate.
export interface UserSelfUpdatePayload {
  full_name?: string;
  phone_number?: string | null;
  password?: string;
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

// Mirrors app/schemas/campus.py::CampusCreate.
export interface CampusCreatePayload {
  code: CampusCode;
  name: string;
  is_active?: boolean;
}

// Mirrors app/schemas/campus.py::CampusUpdate.
export interface CampusUpdatePayload {
  name?: string;
  is_active?: boolean;
}

// Mirrors app/schemas/dashboard-shaped response from app/services/reporting.py::get_dashboard_kpis.
export interface CampusHiringRow {
  campus_code: string;
  hired_count: number;
  open_count: number;
  in_progress_count: number;
}

export interface SourceBreakdownRow {
  source: "Reference" | "Mail" | "Other";
  count: number;
}

// One row per StaffRoleCategoryEnum value, always exactly 3 (TEACHING/
// NON_TEACHING/HOUSEKEEPING, zero-filled not omitted). Deliberately ignores
// the /dashboard/kpis endpoint's own role_category query param -- see
// app/services/reporting.py::get_dashboard_kpis's module docstring -- so this
// array is the same regardless of what role_category the rest of the
// response is scoped to.
export interface CategoryBreakdownRow {
  role_category: StaffRoleCategory;
  applications: number;
  open_positions: number;
  hires: number;
}

export interface DashboardKpis {
  scope_note: string;
  total_applications: number;
  open_positions: number;
  interviews_today: number;
  joinings_today: number;
  offers_pending: number;
  campus_wise_hiring: CampusHiringRow[];
  category_wise_breakdown: CategoryBreakdownRow[];
  average_time_to_hire_days: number | null;
  // null when there's no APPROVED-or-beyond vacancy request in scope to
  // compute a rate from -- rendered as "Not enough data yet", not 0%.
  vacancy_closure_rate_pct: number | null;
  source_wise_breakdown: SourceBreakdownRow[];
  rejected_count: number;
  withdrawn_count: number;
}

// Mirrors app/schemas/department.py::DepartmentRead. code/category/parent_group
// are new, optional master-data fields (Phase 10 Designation Master rollout)
// -- most of the 50+ pre-existing departments won't have them populated yet.
export interface DepartmentRead {
  id: string;
  campus_id: string;
  name: string;
  code: string | null;
  category: StaffRoleCategory | null;
  parent_group: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/department.py::DepartmentCreate.
export interface DepartmentCreatePayload {
  campus_id: string;
  name: string;
  code?: string | null;
  category?: StaffRoleCategory | null;
  parent_group?: string | null;
  is_active?: boolean;
}

// Mirrors app/schemas/department.py::DepartmentUpdate.
export interface DepartmentUpdatePayload {
  name?: string;
  code?: string | null;
  category?: StaffRoleCategory | null;
  parent_group?: string | null;
  is_active?: boolean;
}

// Mirrors app/api/v1/routers/departments.py::_WRITE_ROLES -- CAMPUS_HOD lost
// department-write access with the Department/Designation Master rollout
// (HR_ADMIN deliberately keeps it).
export const DEPARTMENT_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN"];

// Mirrors app/models/enums.py::DESIGNATION_WRITE_ROLES -- deliberately
// narrower than DEPARTMENT_MANAGEMENT_ROLES (no HR_ADMIN).
export const DESIGNATION_WRITE_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];

// Mirrors app/models/enums.py::SANCTIONED_STRENGTH_WRITE_ROLES -- gates the
// Sanctioned Strength page's inline edit / add designation / soft-delete
// affordances (zany-snuggling-pie.md Phase D). History reads stay open to
// any staff role (mirrors app/api/v1/routers/sanctioned_strength.py's
// `_staff_only` gate on GET .../history), so this constant is deliberately
// only consulted for the write actions, never the "View history" trigger.
export const SANCTIONED_STRENGTH_WRITE_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN"];

// Mirrors app/schemas/designation.py::DesignationRead.
export interface DesignationRead {
  id: string;
  name: string;
  category: StaffRoleCategory;
  qualification: string;
  min_experience: string;
  employment_type: EmploymentType;
  is_active: boolean;
  department_ids: string[];
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/designation.py::DesignationCreate.
export interface DesignationCreatePayload {
  name: string;
  category: StaffRoleCategory;
  qualification: string;
  min_experience: string;
  employment_type: EmploymentType;
  is_active?: boolean;
  department_ids?: string[];
}

// Mirrors app/schemas/designation.py::DesignationUpdate.
export type DesignationUpdatePayload = Partial<DesignationCreatePayload>;

// Mirrors app/models/enums.py::CoordinatorCapabilityEnum -- the 4 gated
// action groups a RECRUITMENT_COORDINATOR can be individually granted, via
// app.core.deps.require_roles_or_coordinator_capability. Every other role
// keeps unconditional access to these same endpoints; this list only ever
// applies to RECRUITMENT_COORDINATOR users.
export const COORDINATOR_CAPABILITIES = [
  "VACANCY_APPROVAL",
  "CANDIDATES_APPLICATIONS",
  "INTERVIEWS",
  "JOB_DISTRIBUTION_SCREENING",
] as const;
export type CoordinatorCapability = (typeof COORDINATOR_CAPABILITIES)[number];

export const COORDINATOR_CAPABILITY_LABELS: Record<CoordinatorCapability, string> = {
  VACANCY_APPROVAL: "Vacancy approval (reject / HR-approve / publish / close / cancel)",
  CANDIDATES_APPLICATIONS: "Candidates & applications (write access, any campus)",
  INTERVIEWS: "Interviews (schedule / reschedule / cancel / mark completed)",
  JOB_DISTRIBUTION_SCREENING: "Job distribution & resume screening",
};

// Mirrors app/api/v1/routers/users.py::CoordinatorCapabilitiesRead.
export interface CoordinatorCapabilitiesRead {
  capabilities: CoordinatorCapability[];
}

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleRead.
export interface EligibilityRule {
  id: string;
  campus_id: string;
  staff_category: StaffRoleCategory;
  position_title: string | null;
  required_qualification_keyword: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleCreate.
export interface EligibilityRuleCreatePayload {
  campus_id: string;
  staff_category: StaffRoleCategory;
  position_title?: string | null;
  required_qualification_keyword: string;
  is_active?: boolean;
  notes?: string | null;
}

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleUpdate.
export type EligibilityRuleUpdatePayload = Partial<EligibilityRuleCreatePayload>;

// Mirrors app/models/enums.py::VacancyRequestStatusEnum.
export type VacancyRequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "DEAN_APPROVED"
  | "APPROVED"
  | "PUBLISHED"
  | "CLOSED"
  | "REJECTED"
  | "CANCELLED";

// Mirrors app/models/enums.py::EmploymentTypeEnum. ADJUNCT was added for the
// Designation Master rollout (Phase 10).
export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "VISITING" | "ADJUNCT" | "TRA" | "JRF";

// Mirrors app/models/enums.py::VacancyPriorityEnum.
export type VacancyPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

// Mirrors app/models/enums.py::StaffRoleCategoryEnum.
export type StaffRoleCategory = "TEACHING" | "NON_TEACHING" | "HOUSEKEEPING";

// Mirrors app/schemas/vacancy_request.py::VacancyRequestRead.
export interface VacancyRequestRead {
  id: string;
  campus_id: string;
  department_id: string;
  designation_id: string | null;
  role_category: StaffRoleCategory;
  position_title: string;
  employment_type: EmploymentType;
  requested_count: number;
  qualification: string;
  experience_required: string;
  salary_band_min: number | null;
  salary_band_max: number | null;
  jd_draft: string | null;
  remarks: string | null;
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
  cancelled_by_id: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  // Phase E (zany-snuggling-pie.md): set by vacancy_workflow.py::submit()
  // only when a SUPER_ADMIN explicitly bypassed the "Only N posts available
  // to request" sanction-limit block -- drives the "Over-sanction" badge on
  // VacancyRequestDetailPage/VacancyApprovalsPage.
  is_over_sanction: boolean;
  over_sanction_justification: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/vacancy_request.py::VacancyRequestCreate. Also reused
// (all fields optional) as the PATCH payload shape for edits.
export interface VacancyRequestCreatePayload {
  campus_id: string;
  department_id: string;
  // Backend auto-overwrites position_title from Designation.name when set,
  // but position_title is still required client-side -- always send both.
  designation_id?: string | null;
  role_category: StaffRoleCategory;
  position_title: string;
  employment_type: EmploymentType;
  requested_count: number;
  qualification: string;
  experience_required: string;
  salary_band_min?: number | null;
  salary_band_max?: number | null;
  jd_draft?: string | null;
  // Free-text notes from whoever raised the request -- separate from
  // jd_draft (the actual job-description text, shown on the detail page's
  // "Job Description" card and overwritten by AI JD generation).
  remarks?: string | null;
  skills?: string[] | null;
  priority?: VacancyPriority;
}

export type VacancyRequestUpdatePayload = Partial<Omit<VacancyRequestCreatePayload, "campus_id" | "department_id">>;

// Mirrors app/schemas/vacancy_request.py::VacancyRequestGenerateJDRequest.
export interface VacancyRequestGenerateJDPayload {
  additional_instructions?: string | null;
}

// Mirrors app/schemas/vacancy_request.py::VacancyRequestSubmitRequest (Phase
// E) -- optional body on POST /vacancy-requests/{id}/submit. Only ever sent
// non-empty by a SUPER_ADMIN who has already hit the sanction-limit 409 and
// checked "Override sanction limit" on VacancyRequestDetailPage; every other
// caller submits with no body at all (see submitVacancyRequest's overload).
export interface VacancyRequestSubmitPayload {
  override_sanction?: boolean;
  override_justification?: string | null;
}

// Mirrors app/models/enums.py::NotificationChannelEnum.
export type NotificationChannel = "EMAIL" | "TELEGRAM" | "SMS" | "WHATSAPP";

// Mirrors app/models/enums.py::NotificationStatusEnum -- delivery status
// (was the notification actually sent via its channel), not a read/unread
// flag -- this backend has no per-user read-tracking on notifications.
export type NotificationDeliveryStatus = "PENDING" | "SENT" | "FAILED";

// Mirrors app/schemas/notification.py::NotificationRead.
export interface NotificationRead {
  id: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  campus_context_id: string | null;
  notification_type: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  status: NotificationDeliveryStatus;
  related_entity_type: string | null;
  related_entity_id: string | null;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

// Mirrors app/schemas/audit_log.py::AuditLogRead.
export interface AuditLogRead {
  id: string;
  actor_user_id: string | null;
  actor_role_snapshot: string | null;
  campus_context_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  http_method: string | null;
  http_path: string | null;
  status_code: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// Mirrors app/schemas/migration.py::MigrationRowResult.
export interface MigrationRowResult {
  row_number: number;
  status: "created" | "error";
  vacancy_request_id: string | null;
  errors: string[];
}

// Mirrors app/schemas/migration.py::MigrationImportResponse.
export interface MigrationImportResponse {
  total_rows: number;
  created_count: number;
  error_count: number;
  rows: MigrationRowResult[];
}

// Mirrors app/schemas/tracker_import.py::TrackerVacancyRowResult.
// imported_with_warning: row still imported (designation_id left null,
// falling back to free-text position_title) but its sheet position/designation
// text didn't match Designation Master by name -- flagged for visibility,
// not a hard failure like "flagged".
export interface TrackerVacancyRowResult {
  row_number: number;
  status: "imported" | "imported_with_warning" | "flagged";
  errors: string[];
  vacancy_request_id: string | null;
}

// Mirrors app/schemas/tracker_import.py::TrackerCandidateRowResult.
export interface TrackerCandidateRowResult {
  row_number: number;
  status: "imported" | "imported_with_warning" | "flagged";
  errors: string[];
  application_id: string | null;
}

// Mirrors app/schemas/tracker_import.py::TrackerImportResponse.
export interface TrackerImportResponse {
  vacancy_total_rows: number;
  vacancy_imported_count: number;
  vacancy_flagged_count: number;
  vacancy_rows: TrackerVacancyRowResult[];
  candidate_total_rows: number;
  candidate_imported_count: number;
  candidate_flagged_count: number;
  candidate_rows: TrackerCandidateRowResult[];
}

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

// Mirrors app/schemas/hiring_slot.py::HiringSlotRead.
export interface HiringSlotRead {
  id: string;
  approved_vacancy_id: string;
  slot_number: number;
  status: "OPEN" | "RESERVED" | "FILLED";
  reserved_application_id: string | null;
  reserved_at: string | null;
  filled_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/job_posting.py::JobPostingRead.
export interface JobPostingRead {
  id: string;
  approved_vacancy_id: string;
  campus_id: string;
  // Denormalized from approved_vacancy.vacancy_request.role_category
  // (Phase 1 of the staff-category rollout) -- lets Job Postings/Applications
  // filter by category directly instead of joining up to VacancyRequest.
  role_category: StaffRoleCategory;
  public_apply_slug: string;
  published_at: string;
  closed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Position-tracking fields: requested_count is still-needed (OPEN +
  // RESERVED hiring slots), available_count is already-filled/staffed
  // (FILLED hiring slots) -- the two always sum to the vacancy's originally
  // approved total_positions.
  position_title: string;
  department_id: string;
  requested_count: number;
  available_count: number;
}

// Mirrors app/services/job_distribution.py::SUPPORTED_PORTALS.
export type JobPortal = "LINKEDIN" | "INDEED" | "NAUKRI" | "FACULTYPLUS";

// Mirrors app/schemas/job_distribution.py::JobAdRead.
export interface JobAdRead {
  job_posting_id: string;
  position_title: string;
  campus_code: string;
  employment_type: string;
  role_category: string;
  qualification: string;
  experience_required: string;
  body: string;
  apply_url: string;
  public_apply_slug: string;
}

// Mirrors app/schemas/job_distribution.py::DistributeResponse.
export interface DistributeResponse {
  portals: string[];
  n8n_response: Record<string, unknown> | null;
}

// Mirrors app/schemas/resume_score.py::RankedApplicationRead.
export interface RankedApplicationRead {
  application_id: string;
  candidate_id: string;
  candidate_full_name: string;
  candidate_email: string;
  application_status: string;
  overall_recruitment_score: number | null;
  eligibility_score: number | null;
  is_duplicate: boolean;
  is_incomplete_profile: boolean;
}

// Mirrors app/models/enums.py::ApplicationStatusEnum -- the real,
// currently-manual SIMATS hiring sequence (not a generic ATS pipeline):
// sourcing/shortlisting is manual, a department panel interviews and fixes
// salary, and joining is followed by 3 separate real hand-tracked stages
// (department/room allotment, orientation, handover to HOD) rather than one
// collapsed "onboarding complete" step.
export type ApplicationStatus =
  | "APPLIED"
  | "SCREENING"
  | "CALLED_FOR_INTERVIEW"
  | "INTERVIEWED"
  | "SELECTED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED"
  | "JOINING_CONFIRMED"
  | "JOINED"
  | "DEPARTMENT_ROOM_ALLOTTED"
  | "ORIENTATION_COMPLETE"
  | "HANDED_OVER_TO_HOD"
  | "REJECTED"
  | "WITHDRAWN";

// Mirrors app/models/enums.py::APPLICATION_STATUS_ORDER -- forward-progression
// order for the happy-path pipeline. REJECTED is deliberately excluded, same
// as the backend: it's reachable from any non-terminal status, not just a
// linear predecessor.
export const APPLICATION_STATUS_ORDER: readonly ApplicationStatus[] = [
  "APPLIED",
  "SCREENING",
  "CALLED_FOR_INTERVIEW",
  "INTERVIEWED",
  "SELECTED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "JOINING_CONFIRMED",
  "JOINED",
  "DEPARTMENT_ROOM_ALLOTTED",
  "ORIENTATION_COMPLETE",
  "HANDED_OVER_TO_HOD",
];

// Mirrors app/models/enums.py::APPLICATION_TERMINAL_STATUSES.
export const APPLICATION_TERMINAL_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "HANDED_OVER_TO_HOD",
  "REJECTED",
  "WITHDRAWN",
]);

// Mirrors app/schemas/application.py::ApplicationRead.
export interface ApplicationRead {
  id: string;
  candidate_id: string;
  job_posting_id: string;
  campus_id: string;
  // Denormalized from job_posting.role_category, same rationale as
  // JobPostingRead.role_category above.
  role_category: StaffRoleCategory;
  status: ApplicationStatus;
  applied_at: string;
  recorded_by_id: string;
  rejection_reason: string | null;
  rejected_at: string | null;
  withdrawn_reason: string | null;
  withdrawn_at: string | null;
  panel_members: string | null;
  panel_result: string | null;
  panel_remarks: string | null;
  salary_fixed: number | null;
  called_date: string | null;
  interview_scheduled_date: string | null;
  offer_given_date: string | null;
  expected_joining_date: string | null;
  actual_joining_date: string | null;
  department_allotted_id: string | null;
  room_allotted: string | null;
  orientation_date: string | null;
  hod_assigned: string | null;
  // Mirrors app/services/eligibility.py's non-blocking flag -- purely
  // informational, set at application-creation time; never auto-rejects.
  qualification_mismatch: boolean;
  qualification_mismatch_reason: string | null;
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

// Mirrors app/schemas/application.py::ApplicationPipelineDetailsUpdate --
// the flat, spreadsheet-shaped fields the real manual workflow tracks,
// independent of the status transition itself.
export interface ApplicationPipelineDetailsUpdatePayload {
  panel_members?: string | null;
  panel_result?: string | null;
  panel_remarks?: string | null;
  salary_fixed?: number | null;
  called_date?: string | null;
  interview_scheduled_date?: string | null;
  offer_given_date?: string | null;
  expected_joining_date?: string | null;
}

// Mirrors app/schemas/joining.py::DepartmentRoomAllotmentRequest.
export interface DepartmentRoomAllotmentPayload {
  department_id: string;
  room_allotted?: string | null;
}

// Mirrors app/schemas/joining.py::OrientationCompleteRequest.
export interface OrientationCompletePayload {
  orientation_date?: string | null;
}

// Mirrors app/schemas/joining.py::HandoverToHodRequest.
export interface HandoverToHodPayload {
  hod_assigned: string;
  designation?: string | null;
}

// Mirrors app/schemas/resume_score.py::ResumeScoreRead.
export interface ResumeScoreRead {
  id: string;
  application_id: string;
  eligibility_score: number;
  skill_match_pct: number;
  qualification_match_pct: number;
  experience_match_pct: number;
  publication_count: number;
  overall_recruitment_score: number;
  semantic_similarity_score: number | null;
  rationale: string;
  extracted_skills: string[];
  extracted_qualification: string;
  extracted_experience_years: number;
  is_duplicate: boolean;
  duplicate_of_candidate_id: string | null;
  is_incomplete_profile: boolean;
  incomplete_reasons: string[] | null;
  screened_at: string;
  screened_by_id: string;
  model_version: string;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/candidate.py::CandidateSource -- the 4 real sourcing
// channels; the column itself stays an unconstrained string on the backend,
// this narrows what the app writes.
export type CandidateSource = "Reference" | "Job Portal" | "FacultyPlus" | "Walk-in";

// Mirrors app/schemas/candidate.py::CandidateRead.
export interface CandidateRead {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  resume_storage_key: string | null;
  source: string | null;
  reference_name: string | null;
  is_withdrawn: boolean;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/candidate.py::CandidateCreate.
export interface CandidateCreatePayload {
  full_name: string;
  email: string;
  phone_number?: string | null;
  source?: CandidateSource | null;
  reference_name?: string | null;
}

// Mirrors app/schemas/candidate.py::CandidateWithdrawRequest -- a one-way,
// never-reactivated soft withdraw (same shape as EmployeeOffboardPayload's
// terminal-state pattern, but with no separation-type Select since a
// candidate withdraw has only the one outcome).
export interface CandidateWithdrawPayload {
  reason: string;
}

// Mirrors app/models/enums.py::InterviewTypeEnum.
export type InterviewType = "TECHNICAL" | "HR" | "TEACHING_DEMO" | "GENERAL";

// Mirrors app/models/enums.py::InterviewScheduleStatusEnum.
export type InterviewScheduleStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "RESCHEDULED";

// Mirrors app/models/enums.py::InterviewRecommendationEnum.
export type InterviewRecommendation = "STRONG_HIRE" | "HIRE" | "NO_HIRE" | "STRONG_NO_HIRE";

// Mirrors app/schemas/interview.py::InterviewScheduleRead.
export interface InterviewScheduleRead {
  id: string;
  application_id: string;
  campus_id: string;
  interview_type: InterviewType;
  scheduled_at: string;
  duration_minutes: number;
  meeting_link: string | null;
  location: string | null;
  status: InterviewScheduleStatus;
  scheduled_by_id: string;
  notes: string | null;
  panel_member_ids: string[];
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/interview.py::InterviewScheduleCreate.
export interface InterviewScheduleCreatePayload {
  application_id: string;
  interview_type: InterviewType;
  scheduled_at: string;
  duration_minutes?: number;
  meeting_link?: string | null;
  location?: string | null;
  notes?: string | null;
  panel_member_ids: string[];
}

// Mirrors app/schemas/interview.py::InterviewScheduleUpdate.
export interface InterviewScheduleUpdatePayload {
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  meeting_link?: string | null;
  location?: string | null;
  notes?: string | null;
  status?: InterviewScheduleStatus | null;
}

// Mirrors app/schemas/interview.py::InterviewFeedbackCreate.
export interface InterviewFeedbackCreatePayload {
  technical_score?: number | null;
  communication_score?: number | null;
  research_score?: number | null;
  teaching_demo_score?: number | null;
  overall_recommendation: InterviewRecommendation;
  comments?: string | null;
}

// Mirrors app/schemas/interview.py::InterviewFeedbackRead.
export interface InterviewFeedbackRead {
  id: string;
  interview_schedule_id: string;
  panel_member_id: string;
  technical_score: number | null;
  communication_score: number | null;
  research_score: number | null;
  teaching_demo_score: number | null;
  overall_recommendation: InterviewRecommendation;
  comments: string | null;
  submitted_at: string;
}

// Mirrors app/schemas/interview.py::InterviewQuestionItem/InterviewQuestionsResponse.
export interface InterviewQuestionItem {
  category: string;
  question: string;
}

export interface InterviewQuestionsResponse {
  questions: InterviewQuestionItem[];
}

// Mirrors app/models/enums.py::OfferStatusEnum.
export type OfferStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";

// Mirrors app/schemas/offer.py::OfferRead.
export interface OfferRead {
  id: string;
  application_id: string;
  offered_by_id: string;
  salary_amount: number;
  salary_currency: string;
  joining_date: string;
  terms: string | null;
  status: OfferStatus;
  sent_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/offer.py::OfferCreate.
export interface OfferCreatePayload {
  application_id: string;
  salary_amount: number;
  salary_currency?: string;
  joining_date: string;
  terms?: string | null;
  expires_at?: string | null;
}

// Mirrors app/models/enums.py::JoiningDocumentStatusEnum.
export type JoiningDocumentStatus = "PENDING" | "RECEIVED";

// Mirrors app/schemas/joining.py::JoiningRecordRead.
export interface JoiningRecordRead {
  id: string;
  application_id: string;
  joining_date: string;
  actual_joining_date: string | null;
  onboarding_completed_at: string | null;
  onboarding_completed_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/joining.py::JoiningDocumentRead.
export interface JoiningDocumentRead {
  id: string;
  application_id: string;
  document_type: string;
  status: JoiningDocumentStatus;
  storage_key: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/joining.py::JoiningDocumentUpdate.
export interface JoiningDocumentUpdatePayload {
  status: JoiningDocumentStatus;
  storage_key?: string | null;
  notes?: string | null;
}

// Mirrors app/models/enums.py::EmploymentStatusEnum -- current employment
// state of a hired employee; ACTIVE is the default, the other 3 are terminal
// separation states set via the offboarding endpoint.
export type EmploymentStatus = "ACTIVE" | "RESIGNED" | "TERMINATED" | "RETIRED";

// Mirrors app/schemas/employee.py::EmployeeRead.
export interface EmployeeRead {
  id: string;
  application_id: string;
  employee_code: string;
  campus_id: string;
  department_id: string | null;
  full_name: string;
  email: string;
  phone_number: string | null;
  designation: string;
  date_of_joining: string;
  user_id: string | null;
  employment_status: EmploymentStatus;
  separation_date: string | null;
  separation_reason: string | null;
  separated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/employee.py::EmployeeOffboardRequest.
export interface EmployeeOffboardPayload {
  separation_type: Exclude<EmploymentStatus, "ACTIVE">;
  separation_date: string;
  reason: string;
}

// Mirrors app/services/reporting.py::REPORT_BUILDERS keys.
export type ReportType =
  | "recruitment-funnel"
  | "campus-role-hiring"
  | "interviews"
  | "offers"
  | "joining"
  | "vacancies"
  | "time-to-hire"
  | "sanctioned-strength-reconciliation";

// Mirrors app/schemas/reporting.py::ReportResponse. The backend intentionally
// uses one generic row shape for all 7 report types (see the docstring next
// to ReportResponse) -- each report's actual columns are documented next to
// its builder in app/services/reporting.py.
export interface ReportResponse {
  scope_note: string;
  generated_at: string;
  rows: Record<string, string | number>[];
}

// Mirrors app/schemas/reporting.py::ADBriefingResponse. The index signature
// lets this feed directly into GenericReportTable, which is shaped for the
// backend's generic report-row dicts.
export interface CampusRoleBreakdownRow {
  [key: string]: string | number;
  campus_code: string;
  role_category: string;
  open_positions: number;
  in_pipeline: number;
  hired: number;
}

export interface ADBriefingResponse {
  scope_note: string;
  generated_at: string;
  period_label: string;
  kpi_headline: Record<string, number>;
  campus_role_breakdown: CampusRoleBreakdownRow[];
}

// Mirrors app/schemas/reporting.py::WeeklyStatusRow -- upcoming_join/joined
// are always null on teaching_rows (campus-wise) and always populated on
// non_teaching_rows (position-wise), matching the real hand-built weekly
// PPTX's two-table layout.
export interface WeeklyStatusRow {
  group_label: string;
  attended: number;
  selected: number;
  waiting: number;
  rejected: number;
  upcoming_join: number | null;
  joined: number | null;
}

// Mirrors app/schemas/reporting.py::WeeklyRecruitmentStatusResponse.
export interface WeeklyRecruitmentStatusResponse {
  scope_note: string;
  generated_at: string;
  period_label: string;
  start_date: string;
  end_date: string;
  total_interviewed: number;
  total_selected: number;
  total_waiting: number;
  total_rejected: number;
  total_joined: number;
  selection_rate_pct: number | null;
  joined_by_category: Record<string, number>;
  teaching_rows: WeeklyStatusRow[];
  non_teaching_rows: WeeklyStatusRow[];
}

// Mirrors app/services/vacancy_register.py's derived recruitment_status
// values (staffing headcount vs. sanctioned strength) -- distinct from
// ApprovalStatus below, which tracks the *request* approval chain, not
// staffing levels.
export type RecruitmentStatus = "FULLY_STAFFED" | "VACANCY_EXISTS" | "OVERSTAFFED" | "NO_ACTIVITY";

// Mirrors app/services/vacancy_register.py's derived approval_status values.
export type ApprovalStatus = "APPROVAL_PENDING" | "REJECTED" | "APPROVED" | "NO_REQUESTS";

// Mirrors app/schemas/vacancy_register.py::VacancyRegisterRow. A
// department-level aggregate row (Phase 3 "Vacancy Register" table) -- most
// fields are computed, not literal columns; see that schema's docstring.
export interface VacancyRegisterRow {
  department_id: string;
  department_name: string;
  department_code: string | null;
  category: StaffRoleCategory | null;
  is_active: boolean;
  campus_id: string;
  campus_code: string;

  working_count: number;
  vacancy_count: number;
  approved_count: number;
  filled_pct: number | null;

  requested_count: number;
  approved_request_count: number;
  jd_posted_count: number;
  interviews_count: number;
  offers_count: number;
  joined_count: number;

  recruitment_status: RecruitmentStatus;
  // Phase B (zany-snuggling-pie.md): count of VacancyRequests currently "in
  // flight" (SUBMITTED/DEAN_APPROVED/APPROVED/PUBLISHED) for this
  // department -- an adjacent figure, not literally "how many requests
  // caused this status".
  recruitment_status_request_count: number;
  approval_status: ApprovalStatus;
  // Phase B: count of the VacancyRequests that produced whichever
  // approval_status branch was chosen.
  approval_status_request_count: number;

  last_join: string | null;
  last_resignation: string | null;
  last_updated: string;
}

// Mirrors app/schemas/sanctioned_strength.py::DepartmentDesignationBreakdownRow
// -- one row per designation linked to a department, fetched only when that
// department's row is expanded on the Sanctioned Strength page (see
// api/sanctionedStrength.ts::getDepartmentSanctionedStrengthBreakdown).
export interface DepartmentDesignationBreakdownRow {
  designation_id: string;
  designation_name: string;
  // The current-effective SanctionedStrength row's own id -- null when this
  // designation has never been sanctioned for this department (approved is
  // then 0 by construction). Phase D's SanctionedStrengthEditPopover/
  // AddDesignationRow/delete-confirm/history-drawer all key off this to
  // decide POST-a-new-row vs. PATCH/DELETE/history-on-an-existing-row.
  sanctioned_strength_id: string | null;
  approved: number;
  working: number;
  vacancy: number;
  // The current-effective row's own effective_from/remarks -- both null
  // (same convention as sanctioned_strength_id) when this designation has
  // never been sanctioned for this department. Lets
  // SanctionedStrengthEditPopover pre-fill an edit form alongside approved,
  // matching all 3 fields SanctionedStrengthUpdatePayload accepts.
  effective_from: string | null;
  remarks: string | null;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthRead.
export interface SanctionedStrengthRead {
  id: string;
  campus_id: string;
  department_id: string;
  designation_id: string;
  category: StaffRoleCategory;
  approved_strength: number;
  effective_from: string;
  remarks: string | null;
  is_active: boolean;
  created_by_id: string;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthCreate --
// category is deliberately absent (server derives it from the designation,
// item 6's mismatch check).
export interface SanctionedStrengthCreatePayload {
  campus_id: string;
  department_id: string;
  designation_id: string;
  approved_strength: number;
  effective_from: string;
  remarks?: string | null;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthUpdate --
// the only 3 fields a revision can change; campus/department/designation/
// category are immutable after creation.
export interface SanctionedStrengthUpdatePayload {
  approved_strength?: number;
  effective_from?: string;
  remarks?: string | null;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthAvailabilityRead
// (Phase E) -- GET /sanctioned-strength/availability, shown as the
// availability strip on the New Vacancy Request wizard once
// campus+department+designation are all picked.
export interface SanctionedStrengthAvailabilityRead {
  approved: number;
  working: number;
  vacant: number;
  already_requested: number;
  available_to_request: number;
}

// Mirrors app/models/enums.py::SanctionedStrengthChangeSourceEnum.
export type SanctionedStrengthChangeSource = "MANUAL" | "BULK_UPLOAD";

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthHistoryRead.
export interface SanctionedStrengthHistoryRead {
  id: string;
  sanctioned_strength_id: string;
  old_value: number | null;
  new_value: number;
  changed_by_id: string;
  changed_at: string;
  source: SanctionedStrengthChangeSource;
  bulk_upload_log_id: string | null;
}

// --- Bulk upload (zany-snuggling-pie.md Phase F) ----------------------------
// Mirrors app/schemas/sanctioned_strength_import.py. Rows are keyed on
// (Campus Code, Department Name, Designation Name), not "codes" -- see that
// file's module docstring for why (no designation.code column, non-unique
// department.code).

export type BulkUploadRowStatus = "created" | "updated" | "unchanged" | "rejected";

// Mirrors BulkUploadRowPreview.
export interface BulkUploadRowPreview {
  row_number: number;
  status: BulkUploadRowStatus;
  error_reason: string | null;
  campus_code: string | null;
  department_name: string | null;
  designation_name: string | null;
  approved_strength: number | null;
  effective_from: string | null;
  remarks: string | null;
}

// Mirrors BulkUploadValidationResponse -- returned by both /validate (no
// bulk_upload_log_id yet, nothing persisted) and as the base shape of
// /commit's response below.
export interface BulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  rows: BulkUploadRowPreview[];
}

// Mirrors BulkUploadCommitResponse -- adds the persisted batch's id, which is
// what the error-report download and Upload History tab key off.
export interface BulkUploadCommitResponse extends BulkUploadValidationResponse {
  bulk_upload_log_id: string;
}

// Mirrors app/models/enums.py::BulkUploadStatusEnum.
export type BulkUploadStatus = "COMPLETED" | "UNDONE";

// Mirrors BulkUploadLogRead -- one row per past bulk upload, for the "Upload
// history" tab.
export interface BulkUploadLogRead {
  id: string;
  filename: string;
  uploaded_by_id: string;
  uploaded_at: string;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_rejected: number;
  stored_file_object_key: string | null;
  status: BulkUploadStatus;
  undo_deadline: string;
  undone_at: string | null;
  undone_by_id: string | null;
}

// Mirrors BulkUploadUndoResponse.
export interface BulkUploadUndoResponse {
  id: string;
  status: BulkUploadStatus;
  reverted_history_count: number;
}
