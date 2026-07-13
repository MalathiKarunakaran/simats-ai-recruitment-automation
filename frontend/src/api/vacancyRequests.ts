import { apiFetch } from "@/api/client";
import type {
  ApprovedVacancyRead,
  JobPostingRead,
  PaginatedResponse,
  VacancyRequestCreatePayload,
  VacancyRequestRead,
  VacancyRequestStatus,
  VacancyRequestUpdatePayload,
} from "@/api/types";

export async function listVacancyRequests(status?: VacancyRequestStatus | null): Promise<VacancyRequestRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (status) params.set("status", status);
  const response = await apiFetch<PaginatedResponse<VacancyRequestRead>>(`/vacancy-requests?${params.toString()}`);
  return response.items;
}

export async function getVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}`);
}

export async function createVacancyRequest(payload: VacancyRequestCreatePayload): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>("/vacancy-requests", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateVacancyRequest(
  id: string,
  payload: VacancyRequestUpdatePayload,
): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function deleteVacancyRequest(id: string): Promise<void> {
  await apiFetch<void>(`/vacancy-requests/${id}`, { method: "DELETE" });
}

export async function submitVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/submit`, { method: "POST" });
}

export async function deanApproveVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/dean-approve`, { method: "POST" });
}

export async function rejectVacancyRequest(id: string, reason: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function hrApproveVacancyRequest(id: string): Promise<ApprovedVacancyRead> {
  return apiFetch<ApprovedVacancyRead>(`/vacancy-requests/${id}/hr-approve`, { method: "POST" });
}

export async function publishVacancyRequest(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/vacancy-requests/${id}/publish`, { method: "POST" });
}

export async function closeVacancyRequest(id: string): Promise<VacancyRequestRead> {
  return apiFetch<VacancyRequestRead>(`/vacancy-requests/${id}/close`, { method: "POST" });
}
