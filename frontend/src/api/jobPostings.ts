import { apiFetch } from "@/api/client";
import type {
  JdAiStatusRead,
  JobPostingRead,
  JobPostingUpdatePayload,
  PaginatedResponse,
  RankedApplicationRead,
} from "@/api/types";

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
// vacancy_workflow.close (a Super Admin can reopen the vacancy).
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

// Review stage (2026-09-15). submit / generate: EDIT_JOB_POSTING. approve:
// APPROVE_JOB_POSTING. publish: PUBLISH_JOB_POSTING. return to draft: either
// EDIT_JOB_POSTING or APPROVE_JOB_POSTING.
export async function submitJobPostingForReview(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/submit-for-review`, { method: "POST" });
}

export async function returnJobPostingToDraft(id: string, reason: string | null): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/return-to-draft`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function approveJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/approve`, { method: "POST" });
}

export async function publishJobPosting(id: string): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/publish`, { method: "POST" });
}

export async function generateJobPostingContent(id: string, additionalInstructions: string | null): Promise<JobPostingRead> {
  return apiFetch<JobPostingRead>(`/job-postings/${id}/generate-content`, {
    method: "POST",
    body: JSON.stringify({ additional_instructions: additionalInstructions }),
  });
}

export async function getContentGenerationStatus(): Promise<JdAiStatusRead> {
  return apiFetch<JdAiStatusRead>("/job-postings/content-generation/status");
}
