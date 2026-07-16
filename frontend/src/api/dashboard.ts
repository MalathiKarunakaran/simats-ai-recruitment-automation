import { apiFetch } from "@/api/client";
import type { DashboardKpis } from "@/api/types";

export interface DashboardDateRange {
  startDate?: string | null;
  endDate?: string | null;
}

export async function getDashboardKpis(
  campusCode?: string | null,
  dateRange?: DashboardDateRange,
  roleCategory?: string | null,
): Promise<DashboardKpis> {
  const params = new URLSearchParams();
  if (campusCode) params.set("campus_code", campusCode);
  if (dateRange?.startDate) params.set("start_date", dateRange.startDate);
  if (dateRange?.endDate) params.set("end_date", dateRange.endDate);
  if (roleCategory) params.set("role_category", roleCategory);
  const query = params.toString();
  return apiFetch<DashboardKpis>(`/dashboard/kpis${query ? `?${query}` : ""}`);
}
