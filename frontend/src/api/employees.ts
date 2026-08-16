import { apiFetch } from "@/api/client";
import type { EmployeeOffboardPayload, EmployeeRead, PaginatedResponse } from "@/api/types";

export async function listEmployees(): Promise<EmployeeRead[]> {
  const response = await apiFetch<PaginatedResponse<EmployeeRead>>("/employees?limit=200");
  return response.items;
}

export async function getEmployee(id: string): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/employees/${id}`);
}

// Mirrors GET /employees?department_id=...&designation_id=... (Phase F,
// glowing-zooming-hamming.md -- app/api/v1/routers/employees.py's
// department_id/designation_id params, added specifically to back
// NonTeachingStrengthTable's expand-to-employees affordance). A new,
// single-purpose function rather than overloading listEmployees() (which
// deliberately takes no params and always fetches the unfiltered
// ?limit=200 list) -- matches this file's/codebase's "one small function
// per real query shape" convention (see api/designations.ts's
// listDesignations vs. listDesignationsWithCounts split for the same
// idea). limit=200 mirrors listEmployees()'s own cap -- a single
// (department, designation) slot is never expected to exceed it in
// practice, and there's no pagination UI on the expanded row to page
// through more regardless.
export async function listEmployeesByDepartmentDesignation(
  departmentId: string,
  designationId: string,
): Promise<EmployeeRead[]> {
  const query = new URLSearchParams({
    department_id: departmentId,
    designation_id: designationId,
    limit: "200",
  });
  const response = await apiFetch<PaginatedResponse<EmployeeRead>>(`/employees?${query.toString()}`);
  return response.items;
}

export async function offboardEmployee(id: string, payload: EmployeeOffboardPayload): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/employees/${id}/offboard`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
