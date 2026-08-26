import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  DepartmentBulkUploadCommitResponse,
  DepartmentBulkUploadValidationResponse,
  DepartmentCreatePayload,
  DepartmentListResponse,
  DepartmentRead,
  DepartmentUpdatePayload,
} from "@/api/types";

// Mirrors app/api/v1/routers/departments.py::_SORT_FIELDS exactly.
export type DepartmentSortBy = "name" | "code" | "category" | "campus" | "parent_group" | "is_active";
export type DepartmentSortDirection = "asc" | "desc";

export interface ListDepartmentsParams {
  limit?: number;
  offset?: number;
  search?: string | null;
  category?: string | null;
  is_active?: boolean | null;
  // Only meaningful for global-scope roles -- the backend ignores it for
  // any other role (see departments.py::_base_query), same convention as
  // SanctionedStrengthPage/other campus-scoped list pages.
  campus_id?: string | null;
  // Exact match on Department.parent_group -- backend addition alongside
  // GET /departments/parent-groups (see listDepartmentParentGroups below).
  parent_group?: string | null;
  sort_by?: DepartmentSortBy;
  sort_dir?: DepartmentSortDirection;
}

function buildListDepartmentsQuery(params: ListDepartmentsParams): URLSearchParams {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 200));
  query.set("offset", String(params.offset ?? 0));
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.is_active !== undefined && params.is_active !== null) {
    query.set("is_active", String(params.is_active));
  }
  if (params.campus_id) query.set("campus_id", params.campus_id);
  if (params.parent_group) query.set("parent_group", params.parent_group);
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  return query;
}

// Mirrors the new GET /departments/parent-groups endpoint -- a sorted,
// distinct, campus-scoped-for-non-global-roles list of the real non-null
// parent_group values already in the database (never hardcoded), used to
// populate DepartmentsPage's Parent Group filter Select.
export async function listDepartmentParentGroups(): Promise<string[]> {
  return apiFetch<string[]>("/departments/parent-groups");
}

// Genuinely zero-argument (not an optional-params function) -- same exact
// signature as before the Departments production-hardening epic, kept that
// way on purpose: every existing caller (VacancyRequestForm, UserCreatePage,
// EmployeesListPage, DesignationsPage, JoiningCard, TeachingStrengthTable/
// NonTeachingStrengthTable, etc.) passes `listDepartments` itself as a bare
// `queryFn` reference rather than wrapping it in a lambda, and TanStack
// Query's own `QueryFunctionContext` argument would otherwise fail
// TypeScript's "weak type" (all-properties-optional) assignability check
// against a `ListDepartmentsParams` parameter -- see
// listDepartmentsWithCounts() below for the paginated/filtered/sorted shape
// DepartmentsPage itself now needs, which nobody calls bare this way.
export async function listDepartments(): Promise<DepartmentRead[]> {
  const response = await apiFetch<DepartmentListResponse>("/departments?limit=200");
  return response.items;
}

// Same query as listDepartments(), but returns the full response (total/
// limit/offset/category_counts) for DepartmentsPage's own server-side
// pagination, sorting, and CategoryTabs counts -- same
// listDesignations()/listDesignationsWithCounts() split as designations.ts.
export async function listDepartmentsWithCounts(
  params: ListDepartmentsParams = {},
): Promise<DepartmentListResponse> {
  return apiFetch<DepartmentListResponse>(`/departments?${buildListDepartmentsQuery(params).toString()}`);
}

export async function createDepartment(payload: DepartmentCreatePayload): Promise<DepartmentRead> {
  return apiFetch<DepartmentRead>("/departments", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateDepartment(id: string, payload: DepartmentUpdatePayload): Promise<DepartmentRead> {
  return apiFetch<DepartmentRead>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// Mirrors DELETE /departments/{id} -- same write roles as create/update.
// Soft delete; the backend returns 409 (surfaced via ApiError.message) when
// active users or active designations still reference this department.
export async function deleteDepartment(id: string): Promise<void> {
  await apiFetch<void>(`/departments/${id}`, { method: "DELETE" });
}

// --- Export (Departments production-hardening epic, backend Phase 1) -------
// Mirrors GET /departments/export -- same filters as listDepartments minus
// pagination (no limit/offset -- every matching row is exported). Gated
// `_staff_only` server-side (broader than DEPARTMENT_MANAGEMENT_ROLES), so
// this is deliberately NOT restricted to `canManage` on the frontend either
// -- see DepartmentsPage's own comment on this.

export interface ExportDepartmentsParams {
  search?: string | null;
  category?: string | null;
  is_active?: boolean | null;
  campus_id?: string | null;
  parent_group?: string | null;
  sort_by?: DepartmentSortBy;
  sort_dir?: DepartmentSortDirection;
}

/** Downloads a Blob (auth-header-carrying) and triggers a browser save --
 * same pattern as reports.ts's own triggerDownload/downloadReportExport. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportDepartments(params: ExportDepartmentsParams = {}): Promise<void> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.is_active !== undefined && params.is_active !== null) {
    query.set("is_active", String(params.is_active));
  }
  if (params.campus_id) query.set("campus_id", params.campus_id);
  if (params.parent_group) query.set("parent_group", params.parent_group);
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);

  const qs = query.toString();
  const blob = await apiFetchBlob(`/departments/export${qs ? `?${qs}` : ""}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-departments-${date}.xlsx`);
}

// --- Bulk upload (Departments production-hardening epic, backend Phase 1) --
// Mirrors the entity-specific `/departments/bulk-upload/*` endpoints in
// app/api/v1/routers/departments.py (template/validate/commit -- gated
// require_permission(MANAGE_DEPARTMENTS), same as create/update/delete
// above). The batch-level history/error-report/original-file/undo endpoints
// deliberately stay in api/sanctionedStrength.ts (already entity-agnostic on
// the backend) rather than being duplicated here -- DepartmentBulkUploadDialog
// imports those directly from there instead, same reuse as
// LocationBulkUploadDialog.

/** Downloads the live-generated bulk-upload template (same Blob-download
 * pattern as downloadLocationBulkUploadTemplate). */
export async function downloadDepartmentBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/departments/bulk-upload/template");
  triggerDownload(blob, "department_bulk_upload_template.xlsx");
}

// Mirrors POST /departments/bulk-upload/validate -- read-only, no DB writes;
// returns the per-row preview + summary counts.
export async function validateDepartmentBulkUpload(file: File): Promise<DepartmentBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<DepartmentBulkUploadValidationResponse>("/departments/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Mirrors POST /departments/bulk-upload/commit -- re-sends the same File the
// caller validated (the backend re-validates defensively rather than
// trusting the earlier preview).
export async function commitDepartmentBulkUpload(file: File): Promise<DepartmentBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<DepartmentBulkUploadCommitResponse>("/departments/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
