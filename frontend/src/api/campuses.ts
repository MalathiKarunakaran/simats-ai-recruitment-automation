import { apiFetch } from "@/api/client";
import type { CampusCreatePayload, CampusRead, CampusUpdatePayload, PaginatedResponse } from "@/api/types";

export async function listCampuses(): Promise<CampusRead[]> {
  const response = await apiFetch<PaginatedResponse<CampusRead>>("/campuses?limit=50");
  return response.items;
}

export async function createCampus(payload: CampusCreatePayload): Promise<CampusRead> {
  return apiFetch<CampusRead>("/campuses", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateCampus(id: string, payload: CampusUpdatePayload): Promise<CampusRead> {
  return apiFetch<CampusRead>(`/campuses/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// Mirrors DELETE /campuses/{id} -- SUPER_ADMIN only. Soft delete (is_active
// flips to false, row stays listed); the backend returns 409 (surfaced via
// ApiError.message) when active departments or active users still reference
// this campus.
export async function deleteCampus(id: string): Promise<void> {
  await apiFetch<void>(`/campuses/${id}`, { method: "DELETE" });
}
