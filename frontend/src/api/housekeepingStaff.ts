import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  HousekeepingStaffBulkUploadCommitResponse,
  HousekeepingStaffBulkUploadValidationResponse,
  HousekeepingStaffCreatePayload,
  HousekeepingStaffRead,
  HousekeepingStaffUpdatePayload,
  PaginatedResponse,
} from "@/api/types";

// Mirrors GET /housekeeping-staff -- unlike locations.ts's listLocations(),
// the backend here has no include_inactive flag at all: `is_active` is a
// plain optional filter (None = both active and inactive), so the default
// ?limit=200 fetch (same convention as locations.ts/departments.ts) already
// returns the full roster for this page's own Active/Inactive/All filter to
// narrow client-side, same shape as LocationsPage.
export async function listHousekeepingStaff(): Promise<HousekeepingStaffRead[]> {
  const response = await apiFetch<PaginatedResponse<HousekeepingStaffRead>>("/housekeeping-staff?limit=200");
  return response.items;
}

// Mirrors GET /housekeeping-staff?location_id=... -- the location-scoped
// "lazy-fetch one filtered slice on expand" fetch for
// HousekeepingStrengthTable's roster expand row (glowing-zooming-hamming.md
// Phase G), same precedent as employees.ts's own
// listEmployeesByDepartmentDesignation(). Deliberately a new function, not a
// param added to listHousekeepingStaff() above -- that one is still used
// unchanged by HousekeepingStaffListPage.tsx's own full-roster + client-side
// filter shape (Phase D), a genuinely different fetch pattern (fetch-once,
// filter-in-memory) from this one (fetch-per-expanded-location, server-side
// filtered). limit=200 mirrors listHousekeepingStaff()'s own ceiling -- more
// than any single location's roster is expected to have.
export async function listHousekeepingStaffByLocation(locationId: string): Promise<HousekeepingStaffRead[]> {
  const query = new URLSearchParams({ location_id: locationId, limit: "200" });
  const response = await apiFetch<PaginatedResponse<HousekeepingStaffRead>>(`/housekeeping-staff?${query.toString()}`);
  return response.items;
}

export async function createHousekeepingStaff(
  payload: HousekeepingStaffCreatePayload,
): Promise<HousekeepingStaffRead> {
  return apiFetch<HousekeepingStaffRead>("/housekeeping-staff", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateHousekeepingStaff(
  id: string,
  payload: HousekeepingStaffUpdatePayload,
): Promise<HousekeepingStaffRead> {
  return apiFetch<HousekeepingStaffRead>(`/housekeeping-staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Mirrors DELETE /housekeeping-staff/{id} -- same write roles as
// create/update. Soft delete (is_active=False), no dependency guard (this
// is the leaf of the chain -- nothing references a HousekeepingStaff row).
export async function deleteHousekeepingStaff(id: string): Promise<void> {
  await apiFetch<void>(`/housekeeping-staff/${id}`, { method: "DELETE" });
}

// --- Bulk upload (Phase J, glowing-zooming-hamming.md) -----------------------
// Mirrors the entity-specific `/housekeeping-staff/bulk-upload/*` endpoints
// in app/api/v1/routers/housekeeping_staff.py (template/validate/commit --
// gated HOUSEKEEPING_STAFF_MANAGEMENT_ROLES server-side, same _WRITE_ROLES
// as create/update/delete above). The batch-level history/error-report/
// original-file/undo endpoints deliberately stay in api/sanctionedStrength.ts
// (already entity-agnostic on the backend) rather than being duplicated
// here; HousekeepingStaffBulkUploadDialog imports those 4 directly from
// there instead.

/** Downloads the live-generated bulk-upload template (same Blob-download
 * pattern as downloadSanctionedStrengthBulkUploadTemplate). */
export async function downloadHousekeepingStaffBulkUploadTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/housekeeping-staff/bulk-upload/template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "housekeeping_staff_bulk_upload_template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export interface ExportHousekeepingStaffParams {
  campusId?: string | null;
  locationId?: string | null;
  block?: string | null;
  shift?: string | null;
  isActive?: boolean | null;
  search?: string | null;
}

/** Mirrors GET /housekeeping-staff/export -- same filters as the list, minus
 * pagination. Headers match the bulk-upload template's, so an export can be
 * edited and re-uploaded. */
export async function exportHousekeepingStaff(params: ExportHousekeepingStaffParams = {}): Promise<void> {
  const query = new URLSearchParams();
  if (params.campusId) query.set("campus_id", params.campusId);
  if (params.locationId) query.set("location_id", params.locationId);
  if (params.block) query.set("block", params.block);
  if (params.shift) query.set("shift", params.shift);
  if (params.isActive !== undefined && params.isActive !== null) {
    query.set("is_active", String(params.isActive));
  }
  if (params.search) query.set("search", params.search);

  const qs = query.toString();
  const blob = await apiFetchBlob(`/housekeeping-staff/export${qs ? `?${qs}` : ""}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `simats-housekeeping-staff-${date}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

// Mirrors POST /housekeeping-staff/bulk-upload/validate -- read-only, no DB
// writes; returns the per-row preview + summary counts.
export async function validateHousekeepingStaffBulkUpload(
  file: File,
): Promise<HousekeepingStaffBulkUploadValidationResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<HousekeepingStaffBulkUploadValidationResponse>("/housekeeping-staff/bulk-upload/validate", {
    method: "POST",
    body: formData,
  });
}

// Mirrors POST /housekeeping-staff/bulk-upload/commit -- re-sends the same
// File the caller validated (the backend re-validates defensively rather
// than trusting the earlier preview).
export async function commitHousekeepingStaffBulkUpload(
  file: File,
): Promise<HousekeepingStaffBulkUploadCommitResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<HousekeepingStaffBulkUploadCommitResponse>("/housekeeping-staff/bulk-upload/commit", {
    method: "POST",
    body: formData,
  });
}
