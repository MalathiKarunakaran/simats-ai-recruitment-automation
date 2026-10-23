import { apiFetch } from "@/api/client";
import type {
  PaginatedResponse,
  TalentPoolEntryDetail,
  TalentPoolEntryRead,
  TalentPoolListParams,
  TalentPoolSummary,
} from "@/api/types";

// Talent pool (2026-10-23). Three reads and no writes: the Google Sheet is
// the system of record, so there is deliberately no create/update function
// in this module. See app/api/v1/routers/talent_pool.py.

export async function getTalentPoolSummary(
  sourceTab: TalentPoolListParams["source_tab"],
  deptMode: "group" | "raw" = "group",
  includeInactive = false,
): Promise<TalentPoolSummary> {
  const params = new URLSearchParams({ source_tab: sourceTab, dept_mode: deptMode });
  if (includeInactive) params.set("include_inactive", "true");
  return apiFetch<TalentPoolSummary>(`/talent-pool/summary?${params.toString()}`);
}

export async function listTalentPool(
  input: TalentPoolListParams,
): Promise<PaginatedResponse<TalentPoolEntryRead>> {
  const params = new URLSearchParams({ source_tab: input.source_tab });
  // The backend takes limit/offset like every other list endpoint in this
  // repo; the page thinks in page numbers and converts before calling here.
  if (input.q) params.set("q", input.q);
  if (input.sheet_status) params.set("sheet_status", input.sheet_status);
  if (input.dept_mode) params.set("dept_mode", input.dept_mode);
  if (input.department) params.set("department", input.department);
  if (input.eligibility) params.set("eligibility", input.eligibility);
  if (input.include_inactive) params.set("include_inactive", "true");
  params.set("limit", String(input.limit ?? 25));
  params.set("offset", String(input.offset ?? 0));
  return apiFetch<PaginatedResponse<TalentPoolEntryRead>>(`/talent-pool?${params.toString()}`);
}

export async function getTalentPoolEntry(id: string): Promise<TalentPoolEntryDetail> {
  return apiFetch<TalentPoolEntryDetail>(`/talent-pool/${id}`);
}
