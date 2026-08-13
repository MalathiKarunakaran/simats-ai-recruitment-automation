import { apiFetch } from "@/api/client";
import type { LocationCreatePayload, LocationRead, LocationUpdatePayload, PaginatedResponse } from "@/api/types";

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
