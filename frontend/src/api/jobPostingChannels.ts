import { apiFetch } from "@/api/client";
import type {
  JobPostingChannelRead,
  PaginatedResponse,
  PostChannelResponse,
  PostingAttemptRead,
  RecommendChannelsResponse,
} from "@/api/types";

// Mirrors the channel routes in app/api/v1/routers/job_distribution.py.
// list / post / attempts: JOB_DISTRIBUTION. attach / review / manual
// reference: REVIEW_POSTING_CHANNELS or JOB_DISTRIBUTION. All campus-scoped
// (404, never 403, across campuses).

export async function listPostingChannels(jobPostingId: string): Promise<JobPostingChannelRead[]> {
  const response = await apiFetch<PaginatedResponse<JobPostingChannelRead>>(`/job-postings/${jobPostingId}/channels`);
  return response.items;
}

export async function recommendPostingChannels(jobPostingId: string): Promise<RecommendChannelsResponse> {
  return apiFetch<RecommendChannelsResponse>(`/job-postings/${jobPostingId}/channels/recommend`, { method: "POST" });
}

export async function attachPostingChannel(jobPostingId: string, channelId: string): Promise<JobPostingChannelRead> {
  return apiFetch<JobPostingChannelRead>(`/job-postings/${jobPostingId}/channels`, {
    method: "POST",
    body: JSON.stringify({ channel_id: channelId }),
  });
}

export async function reviewPostingChannel(
  jobPostingId: string,
  channelId: string,
  decision: "SELECT" | "REMOVE",
): Promise<JobPostingChannelRead> {
  return apiFetch<JobPostingChannelRead>(`/job-postings/${jobPostingId}/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ decision }),
  });
}

export async function postPostingChannel(jobPostingId: string, channelId: string): Promise<PostChannelResponse> {
  return apiFetch<PostChannelResponse>(`/job-postings/${jobPostingId}/channels/${channelId}/post`, { method: "POST" });
}

export async function recordManualPosting(
  jobPostingId: string,
  channelId: string,
  payload: { external_ref?: string | null; external_url?: string | null },
): Promise<JobPostingChannelRead> {
  return apiFetch<JobPostingChannelRead>(`/job-postings/${jobPostingId}/channels/${channelId}/manual-posting`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listPostingAttempts(jobPostingId: string, channelId: string): Promise<PostingAttemptRead[]> {
  const response = await apiFetch<PaginatedResponse<PostingAttemptRead>>(
    `/job-postings/${jobPostingId}/channels/${channelId}/attempts`,
  );
  return response.items;
}
