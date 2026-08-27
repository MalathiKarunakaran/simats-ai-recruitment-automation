import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  DesignationBulkUploadCommitResponse,
  DesignationBulkUploadValidationResponse,
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
  // Designation Master production-hardening epic (backend Phase 1) -- name
  // ilike, matching the exact client-side substring-match behavior this
  // replaces (search used to be done 100% client-side in DesignationsPage).
  search?: string;
  limit?: number;
}

function buildListDesignationsQuery(params: ListDesignationsParams): URLSearchParams {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });
  if (params.departmentId) query.set("department_id", params.departmentId);
  if (params.category) query.set("category", params.category);
  if (params.isActive !== undefined) query.set("is_active", String(params.isActive));
  if (params.search) query.set("search", params.search);
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

// --- Export (Designation Master production-hardening epic, backend Phase 1)
// Mirrors GET /designations/export -- same filters as listDesignations minus
// pagination (no limit/offset -- every matching row is exported). Gated
// `_staff_only` server-side (broader than DESIGNATION_WRITE_ROLES), so this
// is deliberately NOT restricted to `canManage` on the frontend either --
// see api/departments.ts::exportDepartments's own comment on this, and
// DesignationsPage's own mirrored comment.

export interface ExportDesignationsParams {
  departmentId?: string;
  category?: StaffRoleCategory;
  isActive?: boolean;
  search?: string;
}

/** Downloads a Blob (auth-header-carrying) and triggers a browser save --
 * same pattern as departments.ts's own triggerDownload/exportDepartments. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportDesignations(params: ExportDesignationsParams = {}): Promise<void> {
  const query = new URLSearchParams();
  if (params.departmentId) query.set("department_id", params.departmentId);
  if (params.category) query.set("category", params.category);
  if (params.isActive !== undefined) query.set("is_active", String(params.isActive));
  if (params.search) query.set("search", params.search);

  const qs = query.toString();
  const blob = await apiFetchBlob(`/designations/export${qs ? `?${qs}` : ""}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-designations-${date}.xlsx`);
}

// --- Bulk upload (Designation Master production-hardening epic, backend
// Phase 1) -------------------------------------------------------------
// Mirrors the entity-specific `/designations/bulk-upload/*` endpoints in
// app/api/v1/routers/designations.py (template/validate/commit -- gated
// DESIGNATION_WRITE_ROLES, same as create/update/delete above). The
// batch-level history/error-report/original-file/undo endpoints
// deliberately stay in api/sanctionedStrength.ts (already entity-agnostic
// on the backend) rather than being duplicated here -- DesignationBulkUploadDialog
// imports those directly from there instead, same reuse as
// DepartmentBulkUploadDialog.

/** Downloads the live-generated bulk-upload template (same Blob-download
 * pattern as downloadDepartmentBulkUploadTemplate). */
export async function downloadDesignationBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/designations/bulk-upload/template");
  triggerDownload(blob, "designation_bulk_upload_template.xlsx");
}

// Mirrors POST /designations/bulk-upload/validate -- read-only, no DB
// writes; returns the per-row preview + summary counts.
export async function validateDesignationBulkUpload(file: File): Promise<DesignationBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<DesignationBulkUploadValidationResponse>("/designations/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Mirrors POST /designations/bulk-upload/commit -- re-sends the same File
// the caller validated (the backend re-validates defensively rather than
// trusting the earlier preview).
export async function commitDesignationBulkUpload(file: File): Promise<DesignationBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<DesignationBulkUploadCommitResponse>("/designations/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
