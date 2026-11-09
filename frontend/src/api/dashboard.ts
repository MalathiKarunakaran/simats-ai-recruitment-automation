import { apiFetch } from "@/api/client";
import type { DashboardKpis, DashboardStrengthTableResponse, PipelineFunnelStage } from "@/api/types";

export interface DashboardDateRange {
  startDate?: string | null;
  endDate?: string | null;
}

/** Drill-down filters (2026-08-30). Every one is optional; omitting all of
 * them produces the exact request this function sent before they existed. */
export interface DashboardFilters {
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
}

export async function getDashboardKpis(
  campusCode?: string | null,
  dateRange?: DashboardDateRange,
  roleCategory?: string | null,
  filters?: DashboardFilters,
): Promise<DashboardKpis> {
  const params = new URLSearchParams();
  if (campusCode) params.set("campus_code", campusCode);
  if (dateRange?.startDate) params.set("start_date", dateRange.startDate);
  if (dateRange?.endDate) params.set("end_date", dateRange.endDate);
  if (roleCategory) params.set("role_category", roleCategory);
  if (filters?.departmentId) params.set("department_id", filters.departmentId);
  if (filters?.designationId) params.set("designation_id", filters.designationId);
  if (filters?.locationId) params.set("location_id", filters.locationId);
  const query = params.toString();
  return apiFetch<DashboardKpis>(`/dashboard/kpis${query ? `?${query}` : ""}`);
}

export interface StrengthTableParams extends DashboardFilters {
  campusCode?: string | null;
  roleCategory?: string | null;
  /** Filters this TABLE only, never the KPI tiles -- filtering the tiles by
   * status would make "Vacancies" self-referential. */
  recruitmentStatus?: string | null;
  limit?: number;
  offset?: number;
}

export async function getDashboardStrengthTable(
  params: StrengthTableParams = {},
): Promise<DashboardStrengthTableResponse> {
  const query = new URLSearchParams();
  if (params.campusCode) query.set("campus_code", params.campusCode);
  if (params.roleCategory) query.set("role_category", params.roleCategory);
  if (params.departmentId) query.set("department_id", params.departmentId);
  if (params.designationId) query.set("designation_id", params.designationId);
  if (params.locationId) query.set("location_id", params.locationId);
  if (params.recruitmentStatus) query.set("recruitment_status", params.recruitmentStatus);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiFetch<DashboardStrengthTableResponse>(`/dashboard/strength-table${qs ? `?${qs}` : ""}`);
}

/** GET /dashboard/pipeline-extras (app/services/pipeline_extras.py) -- the
 * "Joining pipeline" tiles and the pipeline chart's trailing bars. A part is
 * null when the caller's role cannot read that sheet source (Talent Pool,
 * sheet orders/register, selection batches); totals then leave it out. */
export interface TalentPoolOutcomeCounts {
  selected: number;
  joined: number;
  waiting_list: number;
  rejected: number;
  total: number;
}

export interface TalentPoolWaitingPreviewRow {
  id: string;
  full_name: string;
  dept_raw: string | null;
  applied_post: string | null;
}

export interface DashboardPipelineExtras {
  scope_note: string;
  sheet_visible: boolean;
  /** Talent Pool entries and sheet provisional orders carry no campus, so
   * the campus switcher does not narrow them. */
  sheet_ignores_campus: boolean;
  /** "YYYY-MM", the calendar month (India) the orders tile counts. */
  month: string;
  today: string;
  waitlisted: {
    total: number;
    applications: number;
    /** TEACHING / NON_TEACHING / HOUSEKEEPING -> count; absent means none. */
    applications_by_category?: Record<string, number>;
    talent_pool_final: number | null;
    talent_pool_nts: number | null;
  };
  sent_to_university: { total: number; batches: number | null; members: number | null };
  provisional_orders_this_month: { total: number; order_register: number | null; appointment_orders: number };
  awaiting_hod_review: { total: number; applications: number; sheet_overdue: number | null };
  awaiting_permanent_order: { total: number; applications: number };
  pipeline_extension: PipelineFunnelStage[];
  /** Sheet outcomes per tab (Final = Teaching, NTS = Non-teaching), never
   * added together. Sheet rows have no campus, department or date. Null when
   * the caller may not see sheet data. */
  talent_pool_outcomes: { teaching: TalentPoolOutcomeCounts; non_teaching: TalentPoolOutcomeCounts } | null;
  talent_pool_waiting_preview: {
    teaching: TalentPoolWaitingPreviewRow[];
    non_teaching: TalentPoolWaitingPreviewRow[];
  } | null;
}

export async function getDashboardPipelineExtras(campusCode?: string | null): Promise<DashboardPipelineExtras> {
  const query = campusCode ? `?${new URLSearchParams({ campus_code: campusCode }).toString()}` : "";
  return apiFetch<DashboardPipelineExtras>(`/dashboard/pipeline-extras${query}`);
}
