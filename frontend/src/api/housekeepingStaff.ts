import { apiFetch } from "@/api/client";
import type {
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
