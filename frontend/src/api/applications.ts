import { apiFetch } from "@/api/client";
import type {
  ApplicationCreatePayload,
  ApplicationPipelineDetailsUpdatePayload,
  ApplicationRead,
  ApplicationStatus,
  ApplicationStatusTransitionPayload,
  PaginatedResponse,
} from "@/api/types";

interface ListApplicationsFilters {
  status?: ApplicationStatus | null;
  candidateId?: string | null;
  jobPostingId?: string | null;
}

export async function listApplications(filters: ListApplicationsFilters = {}): Promise<ApplicationRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.status) params.set("status", filters.status);
  if (filters.candidateId) params.set("candidate_id", filters.candidateId);
  if (filters.jobPostingId) params.set("job_posting_id", filters.jobPostingId);
  const response = await apiFetch<PaginatedResponse<ApplicationRead>>(`/applications?${params.toString()}`);
  return response.items;
}

export async function getApplication(id: string): Promise<ApplicationRead> {
  return apiFetch<ApplicationRead>(`/applications/${id}`);
}

export async function createApplication(payload: ApplicationCreatePayload): Promise<ApplicationRead> {
  return apiFetch<ApplicationRead>("/applications", { method: "POST", body: JSON.stringify(payload) });
}

export async function transitionApplicationStatus(
  id: string,
  payload: ApplicationStatusTransitionPayload,
): Promise<ApplicationRead> {
  return apiFetch<ApplicationRead>(`/applications/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updateApplicationPipelineDetails(
  id: string,
  payload: ApplicationPipelineDetailsUpdatePayload,
): Promise<ApplicationRead> {
  return apiFetch<ApplicationRead>(`/applications/${id}/pipeline-details`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
