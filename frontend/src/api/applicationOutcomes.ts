import { apiFetch, apiFetchBlob } from "@/api/client";
import type { ApplicationOutcomePage, ApplicationStatus, RejectionCategory, StaffRoleCategory } from "@/api/types";

// app/api/v1/routers/application_outcomes.py -- read-only views; every
// status change still goes through transitionApplicationStatus.

export interface WaitingListFilters {
  roleCategory?: StaffRoleCategory | null;
  campusCode?: string | null;
  jobPostingId?: string | null;
  limit?: number;
  offset?: number;
}

export interface RejectedFilters extends WaitingListFilters {
  rejectionCategory?: RejectionCategory | null;
  rejectedAtStage?: ApplicationStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

function toParams(filters: RejectedFilters, paged: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (paged) {
    params.set("limit", String(filters.limit ?? 50));
    params.set("offset", String(filters.offset ?? 0));
  }
  if (filters.roleCategory) params.set("role_category", filters.roleCategory);
  if (filters.campusCode) params.set("campus_code", filters.campusCode);
  if (filters.jobPostingId) params.set("job_posting_id", filters.jobPostingId);
  if (filters.rejectionCategory) params.set("rejection_category", filters.rejectionCategory);
  if (filters.rejectedAtStage) params.set("rejected_at_stage", filters.rejectedAtStage);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return params;
}

export async function listWaitingList(filters: WaitingListFilters = {}): Promise<ApplicationOutcomePage> {
  return apiFetch<ApplicationOutcomePage>(`/application-outcomes/waiting-list?${toParams(filters, true)}`);
}

export async function listRejected(filters: RejectedFilters = {}): Promise<ApplicationOutcomePage> {
  return apiFetch<ApplicationOutcomePage>(`/application-outcomes/rejected?${toParams(filters, true)}`);
}

async function download(path: string, filename: string): Promise<void> {
  const blob = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportWaitingList(filters: WaitingListFilters = {}): Promise<void> {
  await download(`/application-outcomes/waiting-list/export?${toParams(filters, false)}`, "waiting-list.xlsx");
}

export async function exportRejected(filters: RejectedFilters = {}): Promise<void> {
  await download(`/application-outcomes/rejected/export?${toParams(filters, false)}`, "rejected.xlsx");
}
