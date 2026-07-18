import { apiFetch } from "@/api/client";
import type { EmployeeOffboardPayload, EmployeeRead, PaginatedResponse } from "@/api/types";

export async function listEmployees(): Promise<EmployeeRead[]> {
  const response = await apiFetch<PaginatedResponse<EmployeeRead>>("/employees?limit=200");
  return response.items;
}

export async function getEmployee(id: string): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/employees/${id}`);
}

export async function offboardEmployee(id: string, payload: EmployeeOffboardPayload): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/employees/${id}/offboard`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
