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
