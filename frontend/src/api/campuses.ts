import { apiFetch } from "@/api/client";
import type { CampusRead, PaginatedResponse } from "@/api/types";

export async function listCampuses(): Promise<CampusRead[]> {
  const response = await apiFetch<PaginatedResponse<CampusRead>>("/campuses?limit=50");
  return response.items;
}
