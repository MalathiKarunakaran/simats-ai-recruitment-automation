import { apiFetch } from "@/api/client";
import type { DepartmentRead, PaginatedResponse } from "@/api/types";

export async function listDepartments(): Promise<DepartmentRead[]> {
  const response = await apiFetch<PaginatedResponse<DepartmentRead>>("/departments?limit=200");
  return response.items;
}
