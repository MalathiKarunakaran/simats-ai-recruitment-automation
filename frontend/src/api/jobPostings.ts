import { apiFetch } from "@/api/client";
import type { JobPostingRead, PaginatedResponse } from "@/api/types";

export async function listJobPostings(): Promise<JobPostingRead[]> {
  const response = await apiFetch<PaginatedResponse<JobPostingRead>>("/job-postings?limit=200");
  return response.items;
}
