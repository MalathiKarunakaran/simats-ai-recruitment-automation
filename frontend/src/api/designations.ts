import { apiFetch } from "@/api/client";
import type {
  DesignationCreatePayload,
  DesignationRead,
  DesignationUpdatePayload,
  PaginatedResponse,
  StaffRoleCategory,
} from "@/api/types";

export interface ListDesignationsParams {
  departmentId?: string;
  category?: StaffRoleCategory;
  isActive?: boolean;
  limit?: number;
}

function buildListDesignationsQuery(params: ListDesignationsParams): URLSearchParams {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });
  if (params.departmentId) query.set("department_id", params.departmentId);
  if (params.category) query.set("category", params.category);
  if (params.isActive !== undefined) query.set("is_active", String(params.isActive));
  return query;
}

// Mirrors GET /designations -- open to any staff role except CANDIDATE.
// Unwrapped to the plain array, same convention as listJobPostings()/
// listDepartments() -- most callers (e.g. VacancyRequestWizard) just need
// the list. Use listDesignationsWithCounts() when category_counts is needed.
export async function listDesignations(params: ListDesignationsParams = {}): Promise<DesignationRead[]> {
  const response = await apiFetch<PaginatedResponse<DesignationRead>>(
    `/designations?${buildListDesignationsQuery(params).toString()}`,
  );
  return response.items;
}

// Mirrors app/schemas/designation.py::DesignationListResponse -- additive on
// top of PaginatedResponse: category_counts is a snapshot of
// {"TEACHING": n, "NON_TEACHING": n, "HOUSEKEEPING": n, "ALL": n} across
// every active filter (department_id/is_active) except category itself, so
// a CategoryTabs tab's count doesn't change when a different tab is
// selected.
export interface DesignationListResponse extends PaginatedResponse<DesignationRead> {
  category_counts: Record<string, number>;
}

// Same query as listDesignations(), but returns the full response (incl.
// category_counts) for pages that render a CategoryTabs strip -- currently
// only DesignationsPage.
export async function listDesignationsWithCounts(
  params: ListDesignationsParams = {},
): Promise<DesignationListResponse> {
  return apiFetch<DesignationListResponse>(`/designations?${buildListDesignationsQuery(params).toString()}`);
}

// Mirrors POST /designations -- DESIGNATION_WRITE_ROLES only (backend re-checks).
export async function createDesignation(payload: DesignationCreatePayload): Promise<DesignationRead> {
  return apiFetch<DesignationRead>("/designations", { method: "POST", body: JSON.stringify(payload) });
}

// Mirrors PATCH /designations/{id} -- DESIGNATION_WRITE_ROLES only.
export async function updateDesignation(id: string, payload: DesignationUpdatePayload): Promise<DesignationRead> {
  return apiFetch<DesignationRead>(`/designations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// Mirrors DELETE /designations/{id} -- DESIGNATION_WRITE_ROLES only. Soft
// delete; the backend returns 409 (surfaced via ApiError.message) when
// in-flight vacancy requests or active sanctioned-strength rows still
// reference this designation.
export async function deleteDesignation(id: string): Promise<void> {
  await apiFetch<void>(`/designations/${id}`, { method: "DELETE" });
}
