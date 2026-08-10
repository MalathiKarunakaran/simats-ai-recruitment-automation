import { apiFetch } from "@/api/client";
import type { ApprovalStatus, PaginatedResponse, RecruitmentStatus, VacancyRegisterRow } from "@/api/types";

export type VacancyRegisterSortBy =
  | "department_name"
  | "category"
  | "approved_count"
  | "working_count"
  | "vacancy_count"
  | "filled_pct"
  | "last_join"
  | "last_resignation"
  | "last_updated";

export type SortDirection = "asc" | "desc";

export interface ListVacancyRegisterParams {
  limit?: number;
  offset?: number;
  sort_by?: VacancyRegisterSortBy;
  sort_dir?: SortDirection;
  // Filter-bar params, wired up by VacancyRegisterPage's filter UI.
  campus_code?: string | null;
  category?: string | null;
  department_id?: string | null;
  search?: string | null;
  approval_status?: ApprovalStatus | null;
  recruitment_status?: RecruitmentStatus | null;
  // Defaults server-side to true (active-only), same convention as
  // Departments/Users/Eligibility Rules -- pass false/null explicitly to see
  // inactive/all departments.
  is_active?: boolean | null;
}

// Mirrors app/schemas/vacancy_register.py::VacancyRegisterListResponse --
// additive on top of PaginatedResponse: category_counts is a snapshot of
// {"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n} across
// every active filter *except* category itself, so a CategoryTabs tab's
// count doesn't change when a different tab is selected.
export interface VacancyRegisterListResponse extends PaginatedResponse<VacancyRegisterRow> {
  category_counts: Record<string, number>;
}

// Returns the *full* response (not unwrapped to .items) -- unlike
// listJobPostings()/listDepartments(), this page needs `total` (and now
// category_counts) for real server-side pagination, not a
// fetch-everything-unfiltered list.
export async function listVacancyRegister(
  params: ListVacancyRegisterParams = {},
): Promise<VacancyRegisterListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.campus_code) query.set("campus_code", params.campus_code);
  if (params.category) query.set("category", params.category);
  if (params.department_id) query.set("department_id", params.department_id);
  if (params.search) query.set("search", params.search);
  if (params.approval_status) query.set("approval_status", params.approval_status);
  if (params.recruitment_status) query.set("recruitment_status", params.recruitment_status);
  if (params.is_active !== undefined && params.is_active !== null) {
    query.set("is_active", String(params.is_active));
  }

  const qs = query.toString();
  return apiFetch<VacancyRegisterListResponse>(`/departments/vacancy-register${qs ? `?${qs}` : ""}`);
}
