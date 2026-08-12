import { apiFetch } from "@/api/client";
import type { DepartmentCreatePayload, DepartmentRead, DepartmentUpdatePayload, PaginatedResponse } from "@/api/types";

export async function listDepartments(): Promise<DepartmentRead[]> {
  const response = await apiFetch<PaginatedResponse<DepartmentRead>>("/departments?limit=200");
  return response.items;
}

export async function createDepartment(payload: DepartmentCreatePayload): Promise<DepartmentRead> {
  return apiFetch<DepartmentRead>("/departments", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateDepartment(id: string, payload: DepartmentUpdatePayload): Promise<DepartmentRead> {
  return apiFetch<DepartmentRead>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// Mirrors DELETE /departments/{id} -- same write roles as create/update.
// Soft delete; the backend returns 409 (surfaced via ApiError.message) when
// active users or active designations still reference this department.
export async function deleteDepartment(id: string): Promise<void> {
  await apiFetch<void>(`/departments/${id}`, { method: "DELETE" });
}
