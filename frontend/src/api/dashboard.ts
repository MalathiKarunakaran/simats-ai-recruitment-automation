import { apiFetch } from "@/api/client";
import type { DashboardKpis, DashboardStrengthTableResponse } from "@/api/types";

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
