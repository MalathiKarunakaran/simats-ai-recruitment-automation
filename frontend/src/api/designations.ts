import { apiFetch } from "@/api/client";
import type {
  DesignationCreatePayload,
  DesignationRead,
  DesignationUpdatePayload,
  PaginatedResponse,
  StaffRoleCategory,
} from "@/api/types";

export interface ListDesignationsParams {
  departmentId?: string;
  category?: StaffRoleCategory;
  isActive?: boolean;
  limit?: number;
}

// Mirrors GET /designations -- open to any staff role except CANDIDATE.
export async function listDesignations(params: ListDesignationsParams = {}): Promise<DesignationRead[]> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });
  if (params.departmentId) query.set("department_id", params.departmentId);
  if (params.category) query.set("category", params.category);
  if (params.isActive !== undefined) query.set("is_active", String(params.isActive));
  const response = await apiFetch<PaginatedResponse<DesignationRead>>(`/designations?${query.toString()}`);
  return response.items;
}

// Mirrors POST /designations -- DESIGNATION_WRITE_ROLES only (backend re-checks).
export async function createDesignation(payload: DesignationCreatePayload): Promise<DesignationRead> {
  return apiFetch<DesignationRead>("/designations", { method: "POST", body: JSON.stringify(payload) });
}

// Mirrors PATCH /designations/{id} -- DESIGNATION_WRITE_ROLES only.
export async function updateDesignation(id: string, payload: DesignationUpdatePayload): Promise<DesignationRead> {
  return apiFetch<DesignationRead>(`/designations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
