import { apiFetch } from "@/api/client";
import type { JobPostingRead, JobPostingUpdatePayload, PaginatedResponse, RankedApplicationRead } from "@/api/types";

export async function listJobPostings(): Promise<JobPostingRead[]> {
  const response = await apiFetch<PaginatedResponse<JobPostingRead>>("/job-postings?limit=200");
  return response.items;
}

export async function getJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}`);
}

export async function rankCandidates(jobPostingId: string): Promise<RankedApplicationRead[]> {
  const response = await apiFetch<PaginatedResponse<RankedApplicationRead>>(
    `/job-postings/${jobPostingId}/candidate-ranking?limit=200`,
  );
  return response.items;
}

// Content and lifecycle (2026-09-06). update/pause/resume: EDIT_JOB_POSTING.
// close: CLOSE_VACANCY -- it closes the vacancy too, through
// vacancy_workflow.close (there is no reopen; a closed vacancy is terminal).
export async function updateJobPosting(id: string, payload: JobPostingUpdatePayload): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function pauseJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/pause`, { method: "POST" });
}

export async function resumeJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/resume`, { method: "POST" });
}

export async function closeJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/close`, { method: "POST" });
}
