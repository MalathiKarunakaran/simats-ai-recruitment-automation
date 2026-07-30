import { apiFetch, apiFetchBlob } from "@/api/client";
import type { DistributeResponse, JobAdRead, JobPortal } from "@/api/types";

export async function getJobAd(jobPostingId: string): Promise<JobAdRead> {
  return apiFetch<JobAdRead>(`/job-postings/${jobPostingId}/ad`);
}

export async function getQrCodeBlob(jobPostingId: string): Promise<Blob> {
  return apiFetchBlob(`/job-postings/${jobPostingId}/qr-code`);
}

export async function distributeJobPosting(jobPostingId: string, portals: JobPortal[]): Promise<DistributeResponse> {
  return apiFetch<DistributeResponse>(`/job-postings/${jobPostingId}/distribute`, {
    method: "POST",
    body: JSON.stringify({ portals }),
  });
}
