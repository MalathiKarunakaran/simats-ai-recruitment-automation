import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  ApprovedVacancyRead,
  JobPostingRead,
  PaginatedResponse,
  VacancyRequestCreatePayload,
  VacancyRequestGenerateJDPayload,
  VacancyRequestRead,
  VacancyRequestStatus,
  VacancyRequestSubmitPayload,
  VacancyRequestUpdatePayload,
  VacancyRequestBulkUploadCommitResponse,
  VacancyRequestBulkUploadValidationResponse,
} from "@/api/types";

// Phase H (glowing-zooming-hamming.md) -- optional department_id/
// designation_id filters, additive as a second params object rather than
// changing `status`'s own position, so every pre-existing bare
// listVacancyRequests(status) / listVacancyRequests(null) call site (5 of
// them, none in this file) keeps compiling unchanged. Mirrors the backend's
// own additive department_id/designation_id filters on GET /vacancy-requests
// (app/api/v1/routers/vacancy_requests.py).
export interface ListVacancyRequestsFilters {
  departmentId?: string | null;
  designationId?: string | null;
}

export async function listVacancyRequests(
  status?: VacancyRequestStatus | null,
  filters: ListVacancyRequestsFilters = {},
): Promise<VacancyRequestRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (status) params.set("status", status);
  if (filters.departmentId) params.set("department_id", filters.departmentId);
  if (filters.designationId) params.set("designation_id", filters.designationId);
  const response = await apiFetch<PaginatedResponse<VacancyRequestRead>>(`/vacancy-requests?${params.toString()}`);
  return response.items;
}

export async function getVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}`);
}

export async function createVacancyRequest(payload: VacancyRequestCreatePayload): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>("/vacancy-requests", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateVacancyRequest(
  id: string,
  payload: VacancyRequestUpdatePayload,
): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function deleteVacancyRequest(id: string): Promise<void> {
  await apiFetch<void>(`/vacancy-requests/${id}`, { method: "DELETE" });
}

// Phase E: `payload` is only ever passed by VacancyRequestDetailPage when a
// SUPER_ADMIN has checked "Override sanction limit" after hitting the
// backend's "Only N posts available to request" 409 -- every other caller
// (and every pre-Phase-E test) submits with no body at all, so `payload` is
// omitted from the request entirely rather than sent as an empty object.
export async function submitVacancyRequest(
  id: string,
  payload?: VacancyRequestSubmitPayload,
): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/submit`, {
    method: "POST",
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}

export async function deanApproveVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/dean-approve`, { method: "POST" });
}

export async function rejectVacancyRequest(id: string, reason: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function hrApproveVacancyRequest(id: string): Promise<ApprovedVacancyRead> {
  return apiFetch<ApprovedVacancyRead>(`/vacancy-requests/${id}/hr-approve`, { method: "POST" });
}

export async function publishVacancyRequest(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/vacancy-requests/${id}/publish`, { method: "POST" });
}

export async function closeVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/close`, { method: "POST" });
}

export async function generateJd(
  id: string,
  payload: VacancyRequestGenerateJDPayload,
): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/generate-jd`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelVacancyRequest(id: string, reason: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function updateSlotCount(id: string, requestedCount: number): Promise<ApprovedVacancyRead> {
  return apiFetch<ApprovedVacancyRead>(`/vacancy-requests/${id}/slot-count`, {
    method: "PATCH",
    body: JSON.stringify({ requested_count: requestedCount }),
  });
}

// --- QR intake management (2026-08-30) -------------------------------------
// Staff-facing. The PUBLIC form these point at is in api/publicVacancyRequests.ts
// and goes through publicFetch instead.

export interface VacancyRequestQrInfo {
  url: string;
}

export async function getVacancyRequestQrInfo(): Promise<VacancyRequestQrInfo> {
  return apiFetch<VacancyRequestQrInfo>("/vacancy-requests/qr/info");
}

/** The PNG is fetched as a blob rather than pointed at with a plain <img src>:
 * the endpoint is authenticated, and a bare img tag sends no Authorization
 * header, so it would render a broken image. */
export async function getVacancyRequestQrPng(): Promise<Blob> {
  return apiFetchBlob("/vacancy-requests/qr/code.png");
}

// --- Bulk upload (2026-08-30) ---------------------------------------------
// Mirrors api/locations.ts's own bulk-upload trio. Note that unlike the
// master-data importers, this one is CREATE-ONLY: updated_count and
// unchanged_count come back as 0 always (see
// app/services/vacancy_request_import.py for why a request must not upsert).

export async function downloadVacancyRequestBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/vacancy-requests/bulk-upload/template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vacancy_request_bulk_upload_template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export async function validateVacancyRequestBulkUpload(
  file: File,
): Promise<VacancyRequestBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<VacancyRequestBulkUploadValidationResponse>("/vacancy-requests/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Re-sends the same File the caller validated -- the backend re-validates
// defensively rather than caching parsed rows server-side, same contract as
// every other entity's commit.
export async function commitVacancyRequestBulkUpload(
  file: File,
): Promise<VacancyRequestBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<VacancyRequestBulkUploadCommitResponse>("/vacancy-requests/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
