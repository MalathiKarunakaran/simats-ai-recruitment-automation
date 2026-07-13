import { apiFetch } from "@/api/client";
import type { DashboardKpis } from "@/api/types";

export async function getDashboardKpis(campusCode?: string | null): Promise<DashboardKpis> {
  const params = new URLSearchParams();
  if (campusCode) params.set("campus_code", campusCode);
  const query = params.toString();
  return apiFetch<DashboardKpis>(`/dashboard/kpis${query ? `?${query}` : ""}`);
}
