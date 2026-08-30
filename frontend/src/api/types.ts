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

// Mirrors app/schemas/token.py::TokenPair. must_change_password (Admin
// password reset rollout) drives the forced-password-change route guard --
// see AuthContext.tsx.
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  must_change_password: boolean;
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
  must_change_password: boolean;
  deactivation_protected: boolean;
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

// Mirrors app/schemas/user.py::AdminPasswordReset -- SUPER_ADMIN-only (see
// app/api/v1/routers/users.py::admin_reset_password's require_roles gate),
// deliberately narrower than USER_MANAGEMENT_ROLES.
export interface AdminPasswordResetPayload {
  password: string;
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

// One bucket of DashboardKpis.application_pipeline_funnel -- always exactly
// 7 rows, in this fixed order (Applied -> Screening -> Interview -> Selected
// -> Offer -> Joined -> Rejected). Mirrors
// app/schemas/reporting.py::PipelineFunnelStage.
export interface PipelineFunnelStage {
  stage: string;
  count: number;
}

// One row of DashboardKpis.critical_vacancies -- mirrors
// app/schemas/reporting.py::CriticalVacancyRow. `location` is only ever
// populated for Housekeeping rows (and optionally Teaching/Non-Teaching rows
// that have a Location set) -- see that schema's own docstring.
export interface CriticalVacancyRow {
  department: string;
  designation: string;
  location: string | null;
  category: string;
  vacancy_count: number;
}

// One row of DashboardKpis.recent_joins / .recent_resignations -- mirrors
// app/schemas/reporting.py::RecentEmployeeEventRow.
export interface RecentEmployeeEventRow {
  employee_name: string;
  department: string | null;
  designation: string;
  campus: string;
  date: string;
}

// Mirrors one row from app/services/reporting.py::_vacancy_by_dimension --
// shared by vacancy_by_department / _campus / _category. `key` is the raw
// grouping id (a UUID for department/campus, the enum value for category) and
// is what a drill-down click should send back as a filter; `label` is the
// human-readable name and must never be used as a filter value.
export interface VacancyByDimensionRow {
  key: string;
  label: string;
  approved: number;
  working: number;
  vacancy: number;
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
  // Phase I (glowing-zooming-hamming.md) Sanctioned Strength dashboard tile.
  // Mirrors app/schemas/reporting.py::DashboardKPIResponse -- these DO
  // respect this same call's role_category param (unlike
  // category_wise_breakdown above, which never narrows).
  sanctioned_approved_total: number;
  sanctioned_working_total: number;
  // Deliberately signed, not floored at 0 -- a negative value means the
  // scope in view is net overstaffed overall. Render as-is; don't clamp or
  // hide the sign. See app/services/reporting.py::_sanctioned_strength_totals
  // for the full reasoning.
  sanctioned_vacancy_total: number;
  // Additive fields (Step 3, dashboard-kpi-additions-backend/-frontend) --
  // mirrors app/schemas/reporting.py::DashboardKPIResponse's own additive
  // block. application_pipeline_funnel is always exactly 7 rows, always in
  // the same Applied -> ... -> Rejected order -- don't re-sort it.
  // Dashboard-redesign additions (2026-08-30). Mirrors
  // app/schemas/reporting.py::DashboardKPIResponse.
  //
  // recruitment_required_count counts ROWS whose vacancy is above zero. It is
  // NOT sanctioned_vacancy_total, which is a signed HEADCOUNT sum: one row
  // short by nine people is nine vacancies but one row to recruit for.
  recruitment_required_count: number;
  // Non-overlapping halves of the Dean -> HR workflow: SUBMITTED awaits a
  // Dean, DEAN_APPROVED awaits HR. Safe to show as two cards without
  // double-counting.
  pending_requests_count: number;
  pending_approvals_count: number;
  // All three share one row shape and are built from the same rows as the
  // sanctioned_* totals above, so a chart never contradicts its own KPI card.
  // `vacancy` is signed here for the same reason it is signed there.
  vacancy_by_department: VacancyByDimensionRow[];
  vacancy_by_campus: VacancyByDimensionRow[];
  vacancy_by_category: VacancyByDimensionRow[];
  urgent_vacancy_count: number;
  application_pipeline_funnel: PipelineFunnelStage[];
  critical_vacancies: CriticalVacancyRow[];
  recent_joins: RecentEmployeeEventRow[];
  recent_resignations: RecentEmployeeEventRow[];
}

// Mirrors app/schemas/department.py::DepartmentRead. code/parent_group are
// optional master-data fields (Phase 10 Designation Master rollout) -- most
// of the 50+ pre-existing departments won't have them populated yet.
// description (Departments production-hardening epic, backend Phase 1) is
// free-text and optional, same nullable-until-backfilled story.
//
// supported_categories replaced a single `category` on 2026-08-28: a
// department is a place, not a staff category, and CSE holds Assistant
// Professors (TEACHING) and Lab Assistants (NON_TEACHING) at once. Never
// empty -- the backend enforces at least one member.
export interface DepartmentRead {
  id: string;
  campus_id: string;
  name: string;
  code: string | null;
  supported_categories: StaffRoleCategory[];
  parent_group: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/department.py::DepartmentCreate.
export interface DepartmentCreatePayload {
  campus_id: string;
  name: string;
  code?: string | null;
  supported_categories?: StaffRoleCategory[] | null;
  parent_group?: string | null;
  description?: string | null;
  is_active?: boolean;
}

// Mirrors app/schemas/department.py::DepartmentUpdate.
export interface DepartmentUpdatePayload {
  name?: string;
  code?: string | null;
  supported_categories?: StaffRoleCategory[] | null;
  parent_group?: string | null;
  description?: string | null;
  is_active?: boolean;
}

// Mirrors app/api/v1/routers/departments.py::_WRITE_ROLES -- CAMPUS_HOD lost
// department-write access with the Department/Designation Master rollout
// (HR_ADMIN deliberately keeps it).
export const DEPARTMENT_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN"];

// Mirrors app/schemas/department.py::DepartmentListResponse (Departments
// production-hardening epic, backend Phase 1) -- additive on top of
// PaginatedResponse: category_counts is a snapshot of {"TEACHING": n,
// "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n} across every active filter
// (search/campus_id/is_active) except `category` itself, same shape as
// SanctionedStrengthListResponse/DesignationListResponse -- feed it through
// CategoryTabs' own mapServerCategoryCounts helper.
//
// Since a department can support several categories, these counts OVERLAP
// and no longer sum to ALL; ALL is a distinct department count, matching
// what the All tab actually lists.
export interface DepartmentListResponse extends PaginatedResponse<DepartmentRead> {
  category_counts: Record<string, number>;
}

// Mirrors app/schemas/location.py::LocationRead (glowing-zooming-hamming.md
// Phase B, Location Master -- green-field, nothing else references
// location_id yet). category is nullable (a building can serve multiple
// staff categories, or none yet), unlike Department's own category.
export interface LocationRead {
  id: string;
  campus_id: string;
  name: string;
  block_building: string | null;
  floor_venue: string | null;
  category: StaffRoleCategory | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/location.py::LocationCreate.
export interface LocationCreatePayload {
  campus_id: string;
  name: string;
  block_building?: string | null;
  floor_venue?: string | null;
  category?: StaffRoleCategory | null;
  is_active?: boolean;
}

// Mirrors app/schemas/location.py::LocationUpdate.
export interface LocationUpdatePayload {
  name?: string;
  block_building?: string | null;
  floor_venue?: string | null;
  category?: StaffRoleCategory | null;
  is_active?: boolean;
}

// Mirrors app/api/v1/routers/locations.py::_WRITE_ROLES -- broader than
// DEPARTMENT_MANAGEMENT_ROLES above by design (plan decision 4): the
// spec's "HR Assistant" role maps onto RECRUITMENT_OFFICER, which gets
// direct write/deactivate access here, unlike Department/Designation.
export const LOCATION_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_OFFICER"];

// Mirrors app/models/enums.py::HousekeepingShiftEnum -- a small, bounded
// vocabulary (glowing-zooming-hamming.md Phase D).
export type HousekeepingShift = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

// Mirrors app/schemas/housekeeping_staff.py::HousekeepingStaffRead. A
// separate, standalone roster table from Employee (plan decision 3) --
// location_id is required here (unlike SanctionedStrength.location_id,
// which is nullable and only required-for-HOUSEKEEPING at the router
// level), since every row in this table is Housekeeping staff by
// construction.
export interface HousekeepingStaffRead {
  id: string;
  campus_id: string;
  bio_id: string;
  name: string;
  designation_id: string;
  location_id: string;
  block: string | null;
  floor_venue: string | null;
  shift: HousekeepingShift;
  supervisor: string | null;
  is_active: boolean;
  created_by_id: string;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/housekeeping_staff.py::HousekeepingStaffCreate.
export interface HousekeepingStaffCreatePayload {
  campus_id: string;
  bio_id: string;
  name: string;
  designation_id: string;
  location_id: string;
  block?: string | null;
  floor_venue?: string | null;
  shift: HousekeepingShift;
  supervisor?: string | null;
  is_active?: boolean;
}

// Mirrors app/schemas/housekeeping_staff.py::HousekeepingStaffUpdate.
export interface HousekeepingStaffUpdatePayload {
  bio_id?: string;
  name?: string;
  designation_id?: string;
  location_id?: string;
  block?: string | null;
  floor_venue?: string | null;
  shift?: HousekeepingShift;
  supervisor?: string | null;
  is_active?: boolean;
}

// Mirrors app/api/v1/routers/housekeeping_staff.py::_WRITE_ROLES
// (SANCTIONED_STRENGTH_WRITE_ROLES + RECRUITMENT_OFFICER -- corrected
// post-merge-review, not the bare SANCTIONED_STRENGTH_WRITE_ROLES constant;
// same broader-than-Department write set as LOCATION_MANAGEMENT_ROLES,
// plan decision 4).
export const HOUSEKEEPING_STAFF_MANAGEMENT_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "RECRUITMENT_OFFICER",
];

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

// Mirrors app/api/v1/routers/audit_logs.py::_READ_ROLES exactly (same role
// set AppShell.tsx's own "Activity Log" nav item already gates on) --
// SanctionedStrengthDrawer.tsx (Phase H, glowing-zooming-hamming.md) reuses
// this to hide its Audit Log tab for a viewer who'd otherwise hit a 403 on
// GET /audit-logs the moment they clicked it (e.g. RECRUITMENT_OFFICER/
// MANAGEMENT/INTERVIEW_PANEL_MEMBER, all of whom can still view the drawer
// itself read-only).
export const AUDIT_LOG_READ_ROLES: readonly UserRole[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "ASSOCIATE_DEAN_RECRUITMENT",
  "CAMPUS_HOD",
];

// Mirrors app/schemas/designation.py::DesignationRead.
export interface DesignationRead {
  id: string;
  name: string;
  category: StaffRoleCategory;
  qualification: string;
  min_experience: string;
  employment_type: EmploymentType;
  // Designation Master production-hardening epic (backend Phase 1) --
  // nullable free-text field, no structured skills taxonomy behind it.
  required_skills: string | null;
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
  required_skills?: string | null;
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

// Mirrors app/models/enums.py::PermissionEnum -- the 31-permission matrix,
// generalized beyond RECRUITMENT_COORDINATOR to any staff role.
export const PERMISSIONS = [
  "VIEW_VACANCY", "CREATE_VACANCY_REQUEST", "EDIT_VACANCY_REQUEST", "APPROVE_VACANCY",
  "REJECT_VACANCY", "PUBLISH_VACANCY", "CLOSE_VACANCY", "CANCEL_VACANCY",
  "VIEW_CANDIDATES", "CREATE_CANDIDATE", "EDIT_CANDIDATE", "DELETE_CANDIDATE", "MANAGE_APPLICATIONS",
  "SCHEDULE_INTERVIEW", "RESCHEDULE_INTERVIEW", "CANCEL_INTERVIEW", "MARK_INTERVIEW_COMPLETED",
  "JOB_DISTRIBUTION", "RESUME_SCREENING", "OFFERS", "ONBOARDING",
  "VIEW_EMPLOYEES", "EDIT_EMPLOYEES", "MANAGE_DEPARTMENTS", "MANAGE_DESIGNATIONS",
  "MANAGE_LOCATIONS", "MANAGE_CAMPUSES", "MANAGE_USERS",
  "ACTIVITY_LOG", "REPORTS", "SETTINGS",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Mirrors app/models/enums.py::PERMISSION_CATEGORIES exactly -- same 6
// groups, same order, same membership.
export const PERMISSION_CATEGORIES: { key: string; label: string; permissions: Permission[] }[] = [
  {
    key: "VACANCY_MANAGEMENT",
    label: "Vacancy Management",
    permissions: [
      "VIEW_VACANCY",
      "CREATE_VACANCY_REQUEST",
      "EDIT_VACANCY_REQUEST",
      "APPROVE_VACANCY",
      "REJECT_VACANCY",
      "PUBLISH_VACANCY",
      "CLOSE_VACANCY",
      "CANCEL_VACANCY",
    ],
  },
  {
    key: "CANDIDATES",
    label: "Candidates",
    permissions: ["VIEW_CANDIDATES", "CREATE_CANDIDATE", "EDIT_CANDIDATE", "DELETE_CANDIDATE", "MANAGE_APPLICATIONS"],
  },
  {
    key: "INTERVIEWS",
    label: "Interviews",
    permissions: ["SCHEDULE_INTERVIEW", "RESCHEDULE_INTERVIEW", "CANCEL_INTERVIEW", "MARK_INTERVIEW_COMPLETED"],
  },
  {
    key: "RECRUITMENT",
    label: "Recruitment",
    permissions: ["JOB_DISTRIBUTION", "RESUME_SCREENING", "OFFERS", "ONBOARDING"],
  },
  {
    key: "ADMINISTRATION",
    label: "Administration",
    permissions: [
      "VIEW_EMPLOYEES",
      "EDIT_EMPLOYEES",
      "MANAGE_DEPARTMENTS",
      "MANAGE_DESIGNATIONS",
      "MANAGE_LOCATIONS",
      "MANAGE_CAMPUSES",
      "MANAGE_USERS",
    ],
  },
  {
    key: "SYSTEM",
    label: "System",
    permissions: ["ACTIVITY_LOG", "REPORTS", "SETTINGS"],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  VIEW_VACANCY: "View vacancies",
  CREATE_VACANCY_REQUEST: "Create vacancy requests",
  EDIT_VACANCY_REQUEST: "Edit vacancy requests",
  APPROVE_VACANCY: "Approve vacancies",
  REJECT_VACANCY: "Reject vacancies",
  PUBLISH_VACANCY: "Publish vacancies",
  CLOSE_VACANCY: "Close vacancies",
  CANCEL_VACANCY: "Cancel vacancies",
  VIEW_CANDIDATES: "View candidates",
  CREATE_CANDIDATE: "Create candidates",
  EDIT_CANDIDATE: "Edit candidates",
  DELETE_CANDIDATE: "Delete candidates",
  MANAGE_APPLICATIONS: "Manage applications",
  SCHEDULE_INTERVIEW: "Schedule interviews",
  RESCHEDULE_INTERVIEW: "Reschedule interviews",
  CANCEL_INTERVIEW: "Cancel interviews",
  MARK_INTERVIEW_COMPLETED: "Mark interviews completed",
  JOB_DISTRIBUTION: "Job distribution",
  RESUME_SCREENING: "Resume screening",
  OFFERS: "Manage offers",
  ONBOARDING: "Manage onboarding",
  VIEW_EMPLOYEES: "View employees",
  EDIT_EMPLOYEES: "Edit employees",
  MANAGE_DEPARTMENTS: "Manage departments",
  MANAGE_DESIGNATIONS: "Manage designations",
  MANAGE_LOCATIONS: "Manage locations",
  MANAGE_CAMPUSES: "Manage campuses",
  MANAGE_USERS: "Manage users",
  ACTIVITY_LOG: "View activity log",
  REPORTS: "View reports",
  SETTINGS: "Manage settings",
};

// Mirrors app/api/v1/routers/users.py::UserPermissionsRead.
export interface UserPermissionsRead {
  permissions: Permission[];
}

// Mirrors app/models/enums.py::RegulatoryAuthorityEnum (starter regulatory-
// eligibility-rules feature, backend Phase 1). UGC_AICTE_INSTITUTION is the
// genuinely-ambiguous Design case ("determine per programme"); UNMAPPED_VERIFY
// is a real, honest "not yet mapped" value for campuses/departments where no
// authority could safely be determined yet -- never guess between the two in
// the UI, render both as plain, distinct labels.
export type RegulatoryAuthority =
  | "AICTE_UGC"
  | "COA"
  | "UGC"
  | "UGC_AICTE_INSTITUTION"
  | "NCTE_UGC"
  | "INSTITUTION_NON_TEACHING"
  | "INSTITUTION_HR_HOUSEKEEPING"
  | "UNMAPPED_VERIFY";

// Mirrors app/models/enums.py::EligibilityRuleStatusEnum -- deliberately
// independent of `is_active` (see that enum's own docstring); a rule can be
// status=DRAFT and is_active=false at the same time by design. Never conflate
// the two in the UI -- show both distinctly.
export type EligibilityRuleStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleRead (extended,
// backend Phase 1, for the starter regulatory-eligibility-rules feature).
// required_keywords/preferred_keywords are informational only -- never
// consulted by app/services/eligibility.py::check_qualification_mismatch --
// render them, but never imply they drive an eligibility decision (see
// EligibilityRuleDetailDrawer's own caveat copy).
export interface EligibilityRule {
  id: string;
  campus_id: string;
  department_id: string | null;
  staff_category: StaffRoleCategory;
  position_title: string | null;
  required_qualification_keyword: string;
  net_set_required: boolean | null;
  subject: string | null;
  skills_keyword: string | null;
  id_proof_required: boolean | null;
  shift_preference: string | null;
  regulatory_authority: RegulatoryAuthority | null;
  school_or_college: string | null;
  programme_discipline: string | null;
  minimum_qualification: string | null;
  minimum_percentage: string | null;
  required_experience: string | null;
  required_credential: string | null;
  required_keywords: string | null;
  preferred_keywords: string | null;
  phd_required: boolean | null;
  professional_registration: string | null;
  industry_experience: string | null;
  priority: string | null;
  effective_from: string | null;
  effective_to: string | null;
  source_regulation: string | null;
  status: EligibilityRuleStatus;
  verification_required: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleCreate (extended).
export interface EligibilityRuleCreatePayload {
  campus_id: string;
  department_id?: string | null;
  staff_category: StaffRoleCategory;
  position_title?: string | null;
  required_qualification_keyword: string;
  net_set_required?: boolean | null;
  subject?: string | null;
  skills_keyword?: string | null;
  id_proof_required?: boolean | null;
  shift_preference?: string | null;
  regulatory_authority?: RegulatoryAuthority | null;
  school_or_college?: string | null;
  programme_discipline?: string | null;
  minimum_qualification?: string | null;
  minimum_percentage?: string | null;
  required_experience?: string | null;
  required_credential?: string | null;
  required_keywords?: string | null;
  preferred_keywords?: string | null;
  phd_required?: boolean | null;
  professional_registration?: string | null;
  industry_experience?: string | null;
  priority?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  source_regulation?: string | null;
  status?: EligibilityRuleStatus;
  verification_required?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

// Mirrors app/schemas/eligibility_rule.py::EligibilityRuleUpdate -- every
// field independently optional (PATCH semantics), same as the backend.
export type EligibilityRuleUpdatePayload = Partial<EligibilityRuleCreatePayload>;

// Mirrors GET /eligibility-rules's plain PaginatedResponse shape -- this
// entity deliberately has no category_counts (see the backend router's own
// module docstring / this feature's commit message for why), unlike
// DepartmentListResponse.
export type EligibilityRuleListResponse = PaginatedResponse<EligibilityRule>;

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

// Mirrors app/schemas/candidate.py::CandidateUpdate -- partial edit of the
// basic-details fields only (deliberately excludes is_withdrawn/
// withdrawn_at/withdrawn_reason/resume_storage_key, each owned by its own
// dedicated endpoint).
export interface CandidateUpdatePayload {
  full_name?: string;
  email?: string;
  phone_number?: string | null;
  source?: CandidateSource | null;
  reference_name?: string | null;
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
  // Multi-valued since 2026-08-28, mirroring Department itself. The register
  // still lists one row per department -- a department supporting several
  // categories is NOT duplicated across them.
  supported_categories: StaffRoleCategory[];
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
  // Already the RESOLVED figure: the manual override when the row has one,
  // the live roster count otherwise. Never add the two together.
  working: number;
  // The raw override, or null when the row has none (2026-08-30). Exposed
  // beside `working` because `working` alone cannot tell "someone typed 3"
  // from "3 people are employed" -- and only the first is clearable.
  // Corollary: the live count is recoverable from this payload ONLY when
  // this is null; see SanctionedStrengthDrawer's own `liveWorking`.
  working_override: number | null;
  vacancy: number;
  // The current-effective row's own effective_from/remarks -- both null
  // (same convention as sanctioned_strength_id) when this designation has
  // never been sanctioned for this department. Lets
  // SanctionedStrengthEditPopover pre-fill an edit form alongside approved,
  // matching all 3 fields SanctionedStrengthUpdatePayload accepts.
  effective_from: string | null;
  remarks: string | null;
  // Mirrors app/schemas/sanctioned_strength.py::DepartmentDesignationBreakdownRow's
  // own location_id/location_name (Phase C, glowing-zooming-hamming.md) --
  // the backend has sent these since Phase C, but this frontend type never
  // carried them until Phase H's drawer (glowing-zooming-hamming.md) needed
  // them to pre-fill its own Location tab. Both null, same convention as
  // sanctioned_strength_id, when this designation has never been sanctioned
  // for this department, or when the current-effective row has no
  // location_id set (Teaching/Non-Teaching rows, which stay optional).
  location_id: string | null;
  location_name: string | null;
}

// Mirrors app/schemas/sanctioned_strength_views.py::TeachingStrengthRow
// (glowing-zooming-hamming.md Phase E) -- one row per current-effective
// SanctionedStrength row with category TEACHING, backing
// GET /sanctioned-strength/views/teaching. See that backend module's own
// docstring for every field's derivation and the `status` priority order.
export type TeachingStrengthStatus =
  | "VACANCY_RECRUITMENT_REQUIRED"
  | "FULLY_STAFFED"
  | "OVERSTAFFED"
  | "APPROVAL_PENDING"
  | "INACTIVE";

export interface TeachingStrengthRow {
  sanctioned_strength_id: string;
  campus_id: string;
  campus_code: string | null;
  department_id: string;
  department_name: string | null;
  designation_id: string;
  designation_name: string | null;
  location_id: string | null;
  location_name: string | null;

  approved: number;
  working: number;
  // approved - working, deliberately signed (not floored at 0) -- see the
  // backend module's own docstring.
  vacancy: number;
  // null (not 0.0) when approved === 0.
  filled_pct: number | null;
  status: TeachingStrengthStatus;

  last_join: string | null;
  last_resignation: string | null;
  last_updated: string;
}

// Mirrors app/schemas/sanctioned_strength_views.py::TeachingStrengthListResponse
// -- additive on top of PaginatedResponse: status_counts is a snapshot of
// {"VACANCY_RECRUITMENT_REQUIRED": n, "FULLY_STAFFED": n, "OVERSTAFFED": n,
// "APPROVAL_PENDING": n, "INACTIVE": n, "ALL": n} across every active filter
// except `status` itself, so a status-tabs-style UI's count doesn't collapse
// when a different status is selected.
//
// `approved_total`/`working_total`/`vacancy_total` (Phase K,
// glowing-zooming-hamming.md) back the KPI summary row shown above this
// view's table (components/sanctionedStrength/StrengthKpiSummary.tsx) --
// snapshotted at the same point as `status_counts` (every filter except
// `status` already applied), not recomputed client-side from the current
// page's own rows. `vacancy_total` is a plain sum of each row's own
// already-signed `vacancy` field, so it can legitimately be negative (net
// overstaffed across the filtered scope) -- see the backend schema module's
// own docstring.
export interface TeachingStrengthListResponse extends PaginatedResponse<TeachingStrengthRow> {
  status_counts: Record<string, number>;
  approved_total: number;
  working_total: number;
  vacancy_total: number;
}

// Mirrors app/schemas/sanctioned_strength_views.py::NonTeachingStrengthRow
// (glowing-zooming-hamming.md Phase F) -- the Non-Teaching sibling of
// TeachingStrengthRow above, backing GET /sanctioned-strength/views/non-teaching.
// Field-for-field identical to TeachingStrengthRow (same read-model grain,
// only the upstream `category` filter differs -- see that backend schema
// module's own docstring for why the two row schemas are kept as separate
// (if trivial) types rather than one shared type used directly: distinct
// names read better in tooling/tests and leave room for one view to grow a
// view-only field later without disturbing the other). Kept as its own
// interface here (not `type NonTeachingStrengthRow = TeachingStrengthRow`)
// for the same reason.
export type NonTeachingStrengthStatus = TeachingStrengthStatus;

export interface NonTeachingStrengthRow {
  sanctioned_strength_id: string;
  campus_id: string;
  campus_code: string | null;
  department_id: string;
  department_name: string | null;
  designation_id: string;
  designation_name: string | null;
  location_id: string | null;
  location_name: string | null;

  approved: number;
  working: number;
  vacancy: number;
  filled_pct: number | null;
  status: NonTeachingStrengthStatus;

  last_join: string | null;
  last_resignation: string | null;
  last_updated: string;
}

// Mirrors app/schemas/sanctioned_strength_views.py::NonTeachingStrengthListResponse
// -- same additive status_counts shape as TeachingStrengthListResponse, plus
// the same Phase K `approved_total`/`working_total`/`vacancy_total` KPI
// summary fields (see that interface's own docstring above).
export interface NonTeachingStrengthListResponse extends PaginatedResponse<NonTeachingStrengthRow> {
  status_counts: Record<string, number>;
  approved_total: number;
  working_total: number;
  vacancy_total: number;
}

// Mirrors app/schemas/sanctioned_strength_views.py::HousekeepingStrengthRow
// (glowing-zooming-hamming.md Phase G) -- the Location-grained Housekeeping
// operational view, backing GET /sanctioned-strength/views/housekeeping.
// Deliberately NOT field-for-field identical to TeachingStrengthRow/
// NonTeachingStrengthRow (unlike those two, which mirror each other): this
// row's grain is Location, not (department, designation) -- a single row can
// aggregate more than one current-effective HOUSEKEEPING SanctionedStrength
// record (see the backend schema module's own docstring). No
// sanctioned_strength_id/department_id/department_name/designation_id/
// designation_name fields exist here at all -- there is no single one of any
// of those per row -- and `approved`/`working` are renamed to `required`/
// `available` (this view's own vocabulary, matching the plan's column
// names). `last_join`/`last_resignation`/`last_updated` are likewise absent
// (no clean per-location analogue -- see that backend docstring's own
// explicit scope-decision note).
export type HousekeepingStrengthStatus = TeachingStrengthStatus;

export interface HousekeepingStrengthRow {
  campus_id: string | null;
  campus_code: string | null;
  location_id: string;
  location_name: string | null;
  block: string | null;
  floor_venue: string | null;
  // Distinct, sorted HousekeepingShiftEnum values (as strings) present among
  // this location's active roster -- [] for a location with an active
  // sanction but zero current roster, never an error.
  shifts: string[];

  // SUM(approved_strength) across every current-effective HOUSEKEEPING
  // SanctionedStrength row at this location (a location can have more than
  // one, e.g. Supervisor + Cleaner both sanctioned at the same place).
  required: number;
  // Live COUNT of active HousekeepingStaff rows at this location, across
  // every designation there (not designation-scoped).
  available: number;
  // max(required - available, 0) -- FLOORED at 0, unlike Teaching/
  // Non-Teaching's deliberately signed `vacancy`. `status` below can read
  // "OVERSTAFFED" even while this field reads 0, not negative -- see the
  // backend service module's own docstring, Phase G judgment call #2.
  vacancy: number;
  // One of TEACHING_STRENGTH_STATUS_VALUES (reused as-is here too).
  status: HousekeepingStrengthStatus;
}

// Mirrors app/schemas/sanctioned_strength_views.py::HousekeepingStrengthListResponse
// -- same additive status_counts shape as TeachingStrengthListResponse/
// NonTeachingStrengthListResponse. `required_total`/`available_total`/
// `vacancy_total` (Phase K) are this view's own KPI summary fields,
// snapshotted at the same point as `status_counts`. `vacancy_total` is
// deliberately **NOT** the sum of each row's own floored `vacancy` field --
// it is `required_total - available_total`, computed from the two raw sums
// directly (mirrors `app/services/reporting.py`'s Phase I dashboard-tile
// derivation exactly) -- see the backend schema module's own docstring for
// why flooring each row first and summing would systematically overstate
// the aggregate. A negative `vacancy_total` here honestly means "net
// overstaffed across this filtered scope", same signed-number handling as
// Teaching/Non-Teaching's own `vacancy_total` above.
export interface HousekeepingStrengthListResponse extends PaginatedResponse<HousekeepingStrengthRow> {
  status_counts: Record<string, number>;
  required_total: number;
  available_total: number;
  vacancy_total: number;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthRead.
export interface SanctionedStrengthRead {
  id: string;
  campus_id: string;
  department_id: string;
  designation_id: string;
  category: StaffRoleCategory;
  approved_strength: number;
  working_override: number | null;
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
  // Manually-entered headcount overriding the live Employee/
  // HousekeepingStaff count. Omit or send null for "no override, use the
  // live count" -- which is what every row created before 2026-08-30 has.
  working_override?: number | null;
  effective_from: string;
  remarks?: string | null;
  // Phase C (glowing-zooming-hamming.md) -- optional for Teaching/
  // Non-Teaching, required for Housekeeping (backend-enforced 400, mirrored
  // client-side in SanctionedStrengthDrawer). Never sent by this codebase
  // until Phase H's drawer -- the legacy SanctionedStrengthEditPopover/
  // AddDesignationRow it replaces never grew a Location field despite the
  // backend accepting one since Phase C.
  location_id?: string | null;
}

// Mirrors app/schemas/sanctioned_strength.py::SanctionedStrengthUpdate --
// campus/department/designation/category are immutable after creation;
// location_id is the one exception (Phase C) -- a Housekeeping row may need
// to be re-pointed at a corrected Location without a full new row.
export interface SanctionedStrengthUpdatePayload {
  approved_strength?: number;
  // Unlike every other field here, null is MEANINGFUL rather than "no
  // change": the backend keys this one off the key's presence, so sending
  // null clears the override and hands the row back to the live count,
  // while omitting the key leaves any existing override alone.
  working_override?: number | null;
  effective_from?: string;
  remarks?: string | null;
  location_id?: string | null;
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
  // Non-null ONLY when the row commit itself succeeded but the original
  // workbook's archival copy failed after retries -- a non-blocking
  // warning, never a reason to treat the commit as failed. See
  // app/services/storage.py::try_upload_bulk_upload_file's own docstring.
  storage_warning: string | null;
}

// Mirrors app/models/enums.py::BulkUploadStatusEnum.
export type BulkUploadStatus = "COMPLETED" | "UNDONE";

// Mirrors app/models/enums.py::BulkUploadEntityTypeEnum (Phase J,
// glowing-zooming-hamming.md) -- which master-data entity a given
// BulkUploadLog batch imported. SANCTIONED_STRENGTH is the pre-existing
// value; LOCATION/HOUSEKEEPING_STAFF are new this phase. Used both as the
// `entity_type` filter on GET /sanctioned-strength/bulk-uploads (so each
// entity's own "Upload history" view only shows its own batches -- see
// UploadHistoryTab's new `entityType` prop) and as the value the 4 shared
// endpoints dispatch on server-side.
// DEPARTMENT added for the Departments production-hardening epic
// (backend Phase 1) -- same dispatch-on-entity_type story as LOCATION/
// HOUSEKEEPING_STAFF before it. ELIGIBILITY_RULE added for the starter
// regulatory-eligibility-rules feature (frontend Phase 2), same story again.
// DESIGNATION added for the Designation Master production-hardening epic
// (backend Phase 1 / this frontend Phase 2), same story again.
export type BulkUploadEntityType =
  | "SANCTIONED_STRENGTH"
  | "LOCATION"
  | "HOUSEKEEPING_STAFF"
  | "DEPARTMENT"
  | "ELIGIBILITY_RULE"
  | "DESIGNATION";

// Mirrors BulkUploadLogRead -- one row per past bulk upload, for the "Upload
// history" tab/dialog. `entity_type` (Phase J) is new -- the backend has
// always scoped a batch to exactly one entity type; this field just exposes
// it to the frontend.
export interface BulkUploadLogRead {
  id: string;
  filename: string;
  entity_type: BulkUploadEntityType;
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

// Mirrors BulkUploadUndoResponse. `not_reverted_count` (Phase J) is always 0
// for Sanctioned Strength's own undo (every touched row has a real prior
// value to replay via SanctionedStrengthHistory). It can be > 0 for
// Location/HousekeepingStaff batches, whose undo can only revert rows the
// batch *created* -- rows it *updated* have no stored prior value anywhere
// to revert to (see app/models/bulk_upload_row_log.py's own docstring) and
// are counted here rather than silently skipped.
export interface BulkUploadUndoResponse {
  id: string;
  status: BulkUploadStatus;
  reverted_history_count: number;
  not_reverted_count: number;
}

// --- Location / HousekeepingStaff bulk upload (Phase J,
// glowing-zooming-hamming.md) ------------------------------------------------
// Mirrors app/schemas/location_import.py / app/schemas/
// housekeeping_staff_import.py -- own row-preview/validation/commit shapes
// per entity (different row fields), same pattern as
// BulkUploadRowPreview/BulkUploadValidationResponse/BulkUploadCommitResponse
// above for Sanctioned Strength. BulkUploadRowStatus is shared (same
// created/updated/unchanged/rejected vocabulary for all 3 entities).

// Mirrors LocationBulkUploadRowPreview.
export interface LocationBulkUploadRowPreview {
  row_number: number;
  status: BulkUploadRowStatus;
  error_reason: string | null;
  campus_code: string | null;
  location_name: string | null;
  block_building: string | null;
  floor_venue: string | null;
  category: StaffRoleCategory | null;
}

// Mirrors LocationBulkUploadValidationResponse.
export interface LocationBulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  rows: LocationBulkUploadRowPreview[];
}

// Mirrors LocationBulkUploadCommitResponse.
export interface LocationBulkUploadCommitResponse extends LocationBulkUploadValidationResponse {
  bulk_upload_log_id: string;
  // See BulkUploadCommitResponse's own comment above -- same meaning.
  storage_warning: string | null;
}

// --- Department bulk upload (Departments production-hardening epic,
// backend Phase 1) ------------------------------------------------------
// Mirrors app/schemas/department_import.py -- own row-preview/validation/
// commit shapes (Department's own fields), same pattern as
// LocationBulkUploadRowPreview/-ValidationResponse/-CommitResponse above.

// Mirrors DepartmentBulkUploadRowPreview.
export interface DepartmentBulkUploadRowPreview {
  row_number: number;
  status: BulkUploadRowStatus;
  error_reason: string | null;
  campus_code: string | null;
  department_code: string | null;
  department_name: string | null;
  supported_categories: StaffRoleCategory[] | null;
  parent_group: string | null;
  description: string | null;
  is_active: boolean | null;
}

// Mirrors DepartmentBulkUploadValidationResponse.
export interface DepartmentBulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  rows: DepartmentBulkUploadRowPreview[];
}

// Mirrors DepartmentBulkUploadCommitResponse.
export interface DepartmentBulkUploadCommitResponse extends DepartmentBulkUploadValidationResponse {
  bulk_upload_log_id: string;
  // See BulkUploadCommitResponse's own comment above -- same meaning.
  storage_warning: string | null;
}

// --- Designation bulk upload (Designation Master production-hardening
// epic, backend Phase 1 / this frontend Phase 2) ---------------------------
// Mirrors app/schemas/designation_import.py -- own row-preview shape, since
// Designation rows carry `department_codes` as a display list (a Designation
// can map to multiple departments simultaneously -- see that module's own
// docstring for the (Name, Category) natural-key and its union-within-file /
// replace-against-DB update semantics), not a single `department_id` like
// DepartmentBulkUploadRowPreview.

// Mirrors app/schemas/designation_import.py::DesignationBulkUploadRowStatus.
// Designation alone can return "merged" (several rows describing one
// designation, their department codes unioned), so this deliberately does not
// widen the shared BulkUploadRowStatus every other entity uses.
export type DesignationBulkUploadRowStatus = BulkUploadRowStatus | "merged";

// Mirrors DesignationBulkUploadRowPreview.
export interface DesignationBulkUploadRowPreview {
  row_number: number;
  status: DesignationBulkUploadRowStatus;
  error_reason: string | null;
  // Set only when status is "merged": the earlier row this row's department
  // codes were folded into, which carries the group's real status.
  merged_into_row: number | null;
  name: string | null;
  category: StaffRoleCategory | null;
  department_codes: string[];
  qualification: string | null;
  min_experience: string | null;
  employment_type: EmploymentType | null;
  required_skills: string | null;
  is_active: boolean | null;
}

// Mirrors DesignationBulkUploadValidationResponse.
export interface DesignationBulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  merged_count: number;
  rows: DesignationBulkUploadRowPreview[];
}

// Mirrors DesignationBulkUploadCommitResponse.
export interface DesignationBulkUploadCommitResponse extends DesignationBulkUploadValidationResponse {
  bulk_upload_log_id: string;
  // See BulkUploadCommitResponse's own comment above -- same meaning.
  storage_warning: string | null;
}

// Mirrors HousekeepingStaffBulkUploadRowPreview.
export interface HousekeepingStaffBulkUploadRowPreview {
  row_number: number;
  status: BulkUploadRowStatus;
  error_reason: string | null;
  campus_code: string | null;
  bio_id: string | null;
  name: string | null;
  designation_name: string | null;
  location_name: string | null;
  block: string | null;
  floor_venue: string | null;
  shift: HousekeepingShift | null;
  supervisor: string | null;
}

// Mirrors HousekeepingStaffBulkUploadValidationResponse.
export interface HousekeepingStaffBulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  rows: HousekeepingStaffBulkUploadRowPreview[];
}

// Mirrors HousekeepingStaffBulkUploadCommitResponse.
export interface HousekeepingStaffBulkUploadCommitResponse extends HousekeepingStaffBulkUploadValidationResponse {
  bulk_upload_log_id: string;
  // See BulkUploadCommitResponse's own comment above -- same meaning.
  storage_warning: string | null;
}

// --- EligibilityRule bulk upload (starter regulatory-eligibility-rules
// feature, backend Phase 1 / frontend Phase 2) -----------------------------
// Mirrors app/schemas/eligibility_rule_import.py -- own row-preview shape
// (many more fields than any other bulk-upload entity in this app, since
// EligibilityRule itself carries the full 15-field extended set), same
// pattern as DepartmentBulkUploadRowPreview/-ValidationResponse/
// -CommitResponse above. `rule_status` (not `status`) is deliberately named
// to match the backend schema's own field name -- `status` on this row shape
// is the shared BulkUploadRowStatus (created/updated/unchanged/rejected),
// same distinct-names collision every other entity here avoids too.

// Mirrors EligibilityRuleBulkUploadRowPreview.
export interface EligibilityRuleBulkUploadRowPreview {
  row_number: number;
  status: BulkUploadRowStatus;
  error_reason: string | null;
  campus_code: string | null;
  department_code: string | null;
  staff_category: StaffRoleCategory | null;
  position_title: string | null;
  required_qualification_keyword: string | null;
  net_set_required: boolean | null;
  subject: string | null;
  skills_keyword: string | null;
  id_proof_required: boolean | null;
  shift_preference: string | null;
  regulatory_authority: RegulatoryAuthority | null;
  school_or_college: string | null;
  programme_discipline: string | null;
  minimum_qualification: string | null;
  minimum_percentage: string | null;
  required_experience: string | null;
  required_credential: string | null;
  required_keywords: string | null;
  preferred_keywords: string | null;
  phd_required: boolean | null;
  professional_registration: string | null;
  industry_experience: string | null;
  priority: string | null;
  effective_from: string | null;
  effective_to: string | null;
  source_regulation: string | null;
  rule_status: EligibilityRuleStatus | null;
  verification_required: boolean | null;
  is_active: boolean | null;
  notes: string | null;
}

// Mirrors EligibilityRuleBulkUploadValidationResponse.
export interface EligibilityRuleBulkUploadValidationResponse {
  total: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  rows: EligibilityRuleBulkUploadRowPreview[];
}

// Mirrors EligibilityRuleBulkUploadCommitResponse.
export interface EligibilityRuleBulkUploadCommitResponse extends EligibilityRuleBulkUploadValidationResponse {
  bulk_upload_log_id: string;
  // See BulkUploadCommitResponse's own comment above -- same meaning.
  storage_warning: string | null;
}

// Module 14 "Hermes" assistant (frontend/src/components/assistant/) --
// mirrors app/schemas/assistant.py exactly.

// Mirrors app/schemas/assistant.py::ConversationTurn. Frontend-owned chat
// history -- there is no server-side session, the widget resends whatever
// turns it wants included (capped client-side, see AssistantWidget.tsx).
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// Mirrors app/schemas/assistant.py::AssistantAction -- a deterministic,
// code-generated UI affordance (never derived from the LLM's own answer
// text). `report_type` is deliberately a bare string, not the narrower
// ReportType union above: app/services/hermes.py::_EXPORT_TOOLS can emit
// report types (e.g. "resignations") added to REPORT_BUILDERS after
// ReportType was last updated, and GET /reports/{report_type}/export
// accepts any string it recognizes server-side regardless of this file's
// own ReportType union.
export interface AssistantAction {
  type: "open_page" | "export_excel";
  label: string;
  path?: string | null;
  query?: Record<string, string> | null;
  report_type?: string | null;
  params?: Record<string, string> | null;
}

// Mirrors app/schemas/assistant.py::AssistantQueryResponse.
export interface AssistantQueryResponse {
  answer: string;
  tools_used: string[];
  actions: AssistantAction[];
}
