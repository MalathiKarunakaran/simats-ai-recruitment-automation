import { apiFetch } from "@/api/client";
import type { PaginatedResponse, TalentPoolSourceTab } from "@/api/types";

// Joining records (2026-10-31, docs/specs/joining-screens.md). Reads only:
// the sheets are the record and the sync is the only writer, so there is no
// create/update function here. Mirrors app/api/v1/routers/joining_records.py
// and app/schemas/joining_records.py. The types live in this module rather
// than in types.ts because nothing else uses them.

/** The key a NULL normalised value is counted under, and the filter value
 * that matches it. */
export const NONE_KEY = "none";

export interface MonthCount {
  month: string;
  count: number;
}

export interface CountItem {
  value: string;
  count: number;
}

// --- New Joinees ---------------------------------------------------------

export interface JoineeSummary {
  total: number;
  by_category: Record<string, number>;
  by_employment_state: Record<string, number>;
  by_campus: CountItem[];
  monthly: MonthCount[];
  undated: number;
  flagged: number;
  linked_talent_pool: number;
  last_sync_at: string | null;
}

export interface JoineeRead {
  id: string;
  bio_id: string | null;
  new_bio_id: string | null;
  staff_id: string | null;
  app_no: string | null;
  full_name: string | null;
  employee_type_raw: string | null;
  category: string | null;
  college_raw: string | null;
  campus_code: string | null;
  status_raw: string | null;
  employment_state: string | null;
  joined_on: string | null;
  joined_on_raw: string | null;
  designation: string | null;
  department_raw: string | null;
  dept_new_raw: string | null;
  reporting_to: string | null;
  talent_pool_entry_id: string | null;
  is_active: boolean;
  sheet_row_number: number | null;
}

export interface OrderRead {
  id: string;
  bio_id: string | null;
  emp_id: string | null;
  full_name: string | null;
  order_on: string | null;
  order_on_raw: string | null;
  probation_end_on: string | null;
  probation_end_on_raw: string | null;
  order_status: string | null;
  order_status_raw: string | null;
  outcome: string | null;
  outcome_raw: string | null;
  id_card: string | null;
  food_app: string | null;
  arms: string | null;
  app_360: string | null;
  file_submitted_adfa: string | null;
  room_allotted: string | null;
  sheet_joinee_id: string | null;
  is_active: boolean;
  sheet_row_number: number | null;
}

export interface JoineeDetail extends JoineeRead {
  interview_on: string | null;
  interview_on_raw: string | null;
  prov_order_given_on: string | null;
  prov_order_given_on_raw: string | null;
  send_on: string | null;
  send_on_raw: string | null;
  received_on: string | null;
  received_on_raw: string | null;
  relieving_order_submitted: string | null;
  original_submitted: string | null;
  appointment_order: string | null;
  raw: Record<string, unknown>;
  talent_pool_entry: {
    id: string;
    source_tab: TalentPoolSourceTab;
    sheet_status: string;
    full_name: string;
    is_active: boolean;
  } | null;
  provisional_order: OrderRead | null;
}

export interface JoineeListParams {
  q?: string;
  category?: string;
  employment_state?: string;
  campus_code?: string;
  joined_month?: string;
  flagged?: boolean;
  linked_talent_pool?: boolean;
  include_inactive?: boolean;
  limit?: number;
  offset?: number;
}

// --- Provisional Orders --------------------------------------------------

export interface OrderSummary {
  total: number;
  by_order_status: Record<string, number>;
  by_outcome: Record<string, number>;
  probation_due30: number;
  probation_overdue: number;
  probation_ended: number;
  unlinked: number;
  today: string;
  last_sync_at: string | null;
}

export type ProbationFilter = "due30" | "overdue" | "ended";

export interface OrderListParams {
  q?: string;
  order_status?: string;
  outcome?: string;
  probation?: ProbationFilter;
  linked?: boolean;
  include_inactive?: boolean;
  limit?: number;
  offset?: number;
}

// --- New Departments -----------------------------------------------------

export interface ApprovedDepartmentRow {
  id: string;
  name: string;
  notes: string | null;
  count: number | null;
  count_raw: string | null;
  additional_count: number | null;
  additional_count_raw: string | null;
  approved_total: number;
  members: number;
  active: number;
  active_additional: number;
  left: number;
  on_leave: number;
  hods: string[];
  gap: number;
  is_active: boolean;
}

export interface DepartmentsSummary {
  departments: ApprovedDepartmentRow[];
  unmatched: { name: string; members: number }[];
  faculty_total: number;
  unmatched_total: number;
  last_sync_at: string | null;
}

export interface FacultyRead {
  id: string;
  bio_id: string | null;
  full_name: string | null;
  dept_raw: string | null;
  new_department_id: string | null;
  department_name: string | null;
  role: string | null;
  remark_raw: string | null;
  status_raw: string | null;
  is_additional: boolean;
  top_dept: boolean;
  top25_raw: string | null;
  employment_state: string | null;
  parent_dept_note: string | null;
  sheet_joinee_id: string | null;
  joinee_name: string | null;
  joinee_designation: string | null;
  is_active: boolean;
  sheet_row_number: number | null;
}

export interface FacultyListParams {
  q?: string;
  department?: string;
  role?: string;
  /** "active" (not LEFT), "LEFT", "ON_LEAVE" or "none". */
  state?: string;
  additional?: boolean;
  matched?: boolean;
  include_inactive?: boolean;
  limit?: number;
  offset?: number;
}

// --- calls ---------------------------------------------------------------

function query(input: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export async function getJoineeSummary(includeInactive = false): Promise<JoineeSummary> {
  return apiFetch<JoineeSummary>(`/joining-records/joinees/summary?${query({ include_inactive: includeInactive || undefined })}`);
}

export async function listJoinees(input: JoineeListParams): Promise<PaginatedResponse<JoineeRead>> {
  return apiFetch<PaginatedResponse<JoineeRead>>(`/joining-records/joinees?${query({ limit: 25, offset: 0, ...input })}`);
}

export async function getJoinee(id: string): Promise<JoineeDetail> {
  return apiFetch<JoineeDetail>(`/joining-records/joinees/${id}`);
}

export async function getOrderSummary(includeInactive = false): Promise<OrderSummary> {
  return apiFetch<OrderSummary>(`/joining-records/orders/summary?${query({ include_inactive: includeInactive || undefined })}`);
}

export async function listOrders(input: OrderListParams): Promise<PaginatedResponse<OrderRead>> {
  return apiFetch<PaginatedResponse<OrderRead>>(`/joining-records/orders?${query({ limit: 25, offset: 0, ...input })}`);
}

export async function getDepartmentsSummary(includeInactive = false): Promise<DepartmentsSummary> {
  return apiFetch<DepartmentsSummary>(`/joining-records/departments?${query({ include_inactive: includeInactive || undefined })}`);
}

export async function listFaculty(input: FacultyListParams): Promise<PaginatedResponse<FacultyRead>> {
  return apiFetch<PaginatedResponse<FacultyRead>>(`/joining-records/faculty?${query({ limit: 25, offset: 0, ...input })}`);
}
