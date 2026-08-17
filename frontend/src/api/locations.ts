import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  LocationBulkUploadCommitResponse,
  LocationBulkUploadValidationResponse,
  LocationCreatePayload,
  LocationRead,
  LocationUpdatePayload,
  PaginatedResponse,
} from "@/api/types";

// include_inactive=true so LocationsPage can offer its own Active/Inactive/All
// filter client-side (same shape as DepartmentsPage/listDepartments, which
// also always fetches the full list and filters in the page) -- the
// backend's own include_inactive=false default only matters to a caller
// that wants the API's own active-only behavior; this page's Active filter
// re-implements that same default (active-only) at the UI layer instead.
export async function listLocations(): Promise<LocationRead[]> {
  const response = await apiFetch<PaginatedResponse<LocationRead>>("/locations?limit=200&include_inactive=true");
  return response.items;
}

export async function createLocation(payload: LocationCreatePayload): Promise<LocationRead> {
  return apiFetch<LocationRead>("/locations", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateLocation(id: string, payload: LocationUpdatePayload): Promise<LocationRead> {
  return apiFetch<LocationRead>(`/locations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// Mirrors DELETE /locations/{id} -- same write roles as create/update. Soft
// delete with no dependency guard yet (Phase C adds one once location_id is
// referenced by SanctionedStrength), so there's no 409 case to handle here
// this phase -- errors still surface via ApiError like any other call.
export async function deleteLocation(id: string): Promise<void> {
  await apiFetch<void>(`/locations/${id}`, { method: "DELETE" });
}

// --- Bulk upload (Phase J, glowing-zooming-hamming.md) -----------------------
// Mirrors the entity-specific `/locations/bulk-upload/*` endpoints in
// app/api/v1/routers/locations.py (template/validate/commit -- gated
// LOCATION_MANAGEMENT_ROLES server-side, same _WRITE_ROLES as create/update/
// delete above). The batch-level history/error-report/original-file/undo
// endpoints deliberately stay in api/sanctionedStrength.ts (already
// entity-agnostic on the backend -- see that router's own module docstring)
// rather than being duplicated here; LocationBulkUploadDialog imports those
// 4 directly from there instead.

/** Downloads the live-generated bulk-upload template (same Blob-download
 * pattern as downloadSanctionedStrengthBulkUploadTemplate). */
export async function downloadLocationBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/locations/bulk-upload/template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "location_bulk_upload_template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

// Mirrors POST /locations/bulk-upload/validate -- read-only, no DB writes;
// returns the per-row preview + summary counts.
export async function validateLocationBulkUpload(file: File): Promise<LocationBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<LocationBulkUploadValidationResponse>("/locations/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Mirrors POST /locations/bulk-upload/commit -- re-sends the same File the
// caller validated (the backend re-validates defensively rather than
// trusting the earlier preview).
export async function commitLocationBulkUpload(file: File): Promise<LocationBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<LocationBulkUploadCommitResponse>("/locations/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
