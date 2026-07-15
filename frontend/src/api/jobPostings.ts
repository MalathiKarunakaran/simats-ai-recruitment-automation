import { apiFetch } from "@/api/client";
import type { JobPostingRead, PaginatedResponse, RankedApplicationRead } from "@/api/types";

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
