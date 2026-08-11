import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  ApprovalStatus,
  BulkUploadCommitResponse,
  BulkUploadLogRead,
  BulkUploadUndoResponse,
  BulkUploadValidationResponse,
  DepartmentDesignationBreakdownRow,
  PaginatedResponse,
  RecruitmentStatus,
  SanctionedStrengthAvailabilityRead,
  SanctionedStrengthCreatePayload,
  SanctionedStrengthHistoryRead,
  SanctionedStrengthRead,
  SanctionedStrengthUpdatePayload,
  VacancyRegisterRow,
} from "@/api/types";

// Renamed from vacancyRegister.ts (zany-snuggling-pie.md Phase C) -- the
// frontend page/nav/route are now "Sanctioned Strength", but the backend API
// path deliberately stays /departments/vacancy-register (Phase C wasn't
// asked to touch the API surface, only the frontend-facing name -- see the
// plan's Context section, decision 3). VacancyRegisterRow itself is left
// named as-is in api/types.ts since it mirrors
// app/schemas/vacancy_register.py::VacancyRegisterRow verbatim.

export type SanctionedStrengthSortBy =
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

export interface ListSanctionedStrengthParams {
  limit?: number;
  offset?: number;
  sort_by?: SanctionedStrengthSortBy;
  sort_dir?: SortDirection;
  // Filter-bar params, wired up by SanctionedStrengthPage's filter UI.
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
export interface SanctionedStrengthListResponse extends PaginatedResponse<VacancyRegisterRow> {
  category_counts: Record<string, number>;
}

// Returns the *full* response (not unwrapped to .items) -- unlike
// listJobPostings()/listDepartments(), this page needs `total` (and
// category_counts) for real server-side pagination, not a
// fetch-everything-unfiltered list.
export async function listSanctionedStrengthRegister(
  params: ListSanctionedStrengthParams = {},
): Promise<SanctionedStrengthListResponse> {
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
  return apiFetch<SanctionedStrengthListResponse>(`/departments/vacancy-register${qs ? `?${qs}` : ""}`);
}

// Mirrors GET /departments/{department_id}/sanctioned-strength-breakdown
// (app/api/v1/routers/vacancy_register.py) -- one row per designation
// linked to the department, only fetched when that department's row is
// expanded on SanctionedStrengthPage (never eagerly for every department in
// the list).
export async function getDepartmentSanctionedStrengthBreakdown(
  departmentId: string,
): Promise<DepartmentDesignationBreakdownRow[]> {
  const response = await apiFetch<{ items: DepartmentDesignationBreakdownRow[] }>(
    `/departments/${departmentId}/sanctioned-strength-breakdown`,
  );
  return response.items;
}

export interface SanctionedStrengthAvailabilityParams {
  campusId: string;
  departmentId: string;
  designationId: string;
}

// Mirrors GET /sanctioned-strength/availability (zany-snuggling-pie.md Phase
// E) -- the New Vacancy Request wizard's availability strip. Only ever
// called once campus+department+designation are all picked (designation_id
// is a required query param server-side, and Sanctioned Strength is keyed at
// designation granularity, so there's nothing to show before that).
export async function getSanctionedStrengthAvailability(
  params: SanctionedStrengthAvailabilityParams,
): Promise<SanctionedStrengthAvailabilityRead> {
  const query = new URLSearchParams({
    campus_id: params.campusId,
    department_id: params.departmentId,
    designation_id: params.designationId,
  });
  return apiFetch<SanctionedStrengthAvailabilityRead>(`/sanctioned-strength/availability?${query.toString()}`);
}

// --- CRUD + history (zany-snuggling-pie.md Phase D) -------------------------
// Mirrors app/api/v1/routers/sanctioned_strength.py -- writes gated to
// SANCTIONED_STRENGTH_WRITE_ROLES (api/types.ts), reads (history) staff-only.

// Mirrors POST /sanctioned-strength -- used when a designation row in the
// breakdown has no current-effective SanctionedStrength yet
// (sanctioned_strength_id === null), i.e. "Approved" is being set for the
// first time rather than revised.
export async function createSanctionedStrength(
  payload: SanctionedStrengthCreatePayload,
): Promise<SanctionedStrengthRead> {
  return apiFetch<SanctionedStrengthRead>("/sanctioned-strength", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Mirrors PATCH /sanctioned-strength/{id} -- only accepts
// approved_strength/effective_from/remarks (see SanctionedStrengthUpdatePayload).
export async function updateSanctionedStrength(
  id: string,
  payload: SanctionedStrengthUpdatePayload,
): Promise<SanctionedStrengthRead> {
  return apiFetch<SanctionedStrengthRead>(`/sanctioned-strength/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Mirrors DELETE /sanctioned-strength/{id} -- soft delete; the backend
// returns 409 (surfaced via ApiError.message) when active employees still
// occupy this (department, designation) key.
export async function deleteSanctionedStrength(id: string): Promise<void> {
  await apiFetch<void>(`/sanctioned-strength/${id}`, { method: "DELETE" });
}

export interface ListSanctionedStrengthHistoryParams {
  limit?: number;
  offset?: number;
}

// Mirrors GET /sanctioned-strength/{id}/history -- newest-first, paginated.
export async function getSanctionedStrengthHistory(
  id: string,
  params: ListSanctionedStrengthHistoryParams = {},
): Promise<PaginatedResponse<SanctionedStrengthHistoryRead>> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  return apiFetch<PaginatedResponse<SanctionedStrengthHistoryRead>>(
    `/sanctioned-strength/${id}/history?${query.toString()}`,
  );
}

// --- Bulk upload (zany-snuggling-pie.md Phase F) -----------------------------
// Mirrors the `/sanctioned-strength/bulk-upload*` endpoints in
// app/api/v1/routers/sanctioned_strength.py -- all gated
// SANCTIONED_STRENGTH_WRITE_ROLES. No server-side caching of parsed rows
// between validate and commit: the client re-uploads the same File object to
// /commit (see BulkUploadDialog), matching the backend's deliberate
// no-new-session-infra choice.

/** Downloads the live-generated bulk-upload template (Blob pattern, same as
 * downloadTrackerTemplate/downloadReportExport). */
export async function downloadSanctionedStrengthBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/sanctioned-strength/bulk-upload/template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sanctioned_strength_bulk_upload_template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

// Mirrors POST /sanctioned-strength/bulk-upload/validate -- read-only, no DB
// writes; returns the per-row preview + summary counts.
export async function validateSanctionedStrengthBulkUpload(file: File): Promise<BulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<BulkUploadValidationResponse>("/sanctioned-strength/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Mirrors POST /sanctioned-strength/bulk-upload/commit -- re-sends the same
// File the caller validated (the backend re-validates defensively rather
// than trusting the earlier preview).
export async function commitSanctionedStrengthBulkUpload(file: File): Promise<BulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<BulkUploadCommitResponse>("/sanctioned-strength/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}

/** Downloads a completed batch's rejected-rows-only report. */
export async function downloadSanctionedStrengthBulkUploadErrorReport(bulkUploadLogId: string): Promise<void> {
  const blob = await apiFetchBlob(`/sanctioned-strength/bulk-upload/${bulkUploadLogId}/error-report`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sanctioned-strength-bulk-upload-${bulkUploadLogId}-errors.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export interface ListBulkUploadsParams {
  limit?: number;
  offset?: number;
}

// Mirrors GET /sanctioned-strength/bulk-uploads -- newest-first, for the
// "Upload history" tab. Not campus-scoped (a batch can span campuses).
export async function listSanctionedStrengthBulkUploads(
  params: ListBulkUploadsParams = {},
): Promise<PaginatedResponse<BulkUploadLogRead>> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  return apiFetch<PaginatedResponse<BulkUploadLogRead>>(`/sanctioned-strength/bulk-uploads?${query.toString()}`);
}

/** Proxied download of the originally-uploaded file -- `filename` is passed
 * in by the caller (the BulkUploadLogRead row it already has), same as
 * candidates.ts::downloadResume, since apiFetchBlob doesn't expose response
 * headers. */
export async function downloadSanctionedStrengthBulkUploadOriginalFile(
  bulkUploadLogId: string,
  filename: string,
): Promise<void> {
  const blob = await apiFetchBlob(`/sanctioned-strength/bulk-uploads/${bulkUploadLogId}/original-file`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Mirrors POST /sanctioned-strength/bulk-uploads/{id}/undo -- only succeeds
// within the batch's 24h undo_deadline (server-enforced 409 after that).
export async function undoSanctionedStrengthBulkUpload(bulkUploadLogId: string): Promise<BulkUploadUndoResponse> {
  return apiFetch<BulkUploadUndoResponse>(`/sanctioned-strength/bulk-uploads/${bulkUploadLogId}/undo`, {
    method: "POST",
  });
}
