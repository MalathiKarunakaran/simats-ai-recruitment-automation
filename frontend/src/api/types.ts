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
