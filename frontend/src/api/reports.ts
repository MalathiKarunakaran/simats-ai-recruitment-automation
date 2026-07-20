import { apiFetch, apiFetchBlob } from "@/api/client";
import type { ADBriefingResponse, ReportResponse, ReportType } from "@/api/types";

interface ReportFilters {
  campusCode?: string | null;
  roleCategory?: string | null;
}

interface AdBriefingFilters {
  campusCode?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

function buildParams(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.campusCode) params.set("campus_code", filters.campusCode);
  if (filters.roleCategory) params.set("role_category", filters.roleCategory);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildAdBriefingParams(filters: AdBriefingFilters): string {
  const params = new URLSearchParams();
  if (filters.campusCode) params.set("campus_code", filters.campusCode);
  if (filters.startDate) params.set("start_date", filters.startDate);
  if (filters.endDate) params.set("end_date", filters.endDate);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getReport(reportType: ReportType, filters: ReportFilters = {}): Promise<ReportResponse> {
  return apiFetch<ReportResponse>(`/reports/${reportType}${buildParams(filters)}`);
}

export async function getAdBriefing(filters: AdBriefingFilters = {}): Promise<ADBriefingResponse> {
  return apiFetch<ADBriefingResponse>(`/reports/ad-briefing${buildAdBriefingParams(filters)}`);
}

/** Downloads a Blob (auth-header-carrying) and triggers a browser save --
 * a plain <a href> can't carry the Bearer token. Same pattern as
 * downloadResume in candidates.ts. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadReportExport(reportType: ReportType, filters: ReportFilters = {}): Promise<void> {
  const blob = await apiFetchBlob(`/reports/${reportType}/export${buildParams(filters)}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-${reportType}-${date}.xlsx`);
}

export async function downloadAdBriefingExport(filters: AdBriefingFilters = {}): Promise<void> {
  const blob = await apiFetchBlob(`/reports/ad-briefing/export${buildAdBriefingParams(filters)}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-ad-briefing-${date}.pptx`);
}
