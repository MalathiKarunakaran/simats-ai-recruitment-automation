import { apiFetch, apiFetchBlob } from "@/api/client";
import type { CandidateCreatePayload, CandidateRead, CandidateWithdrawPayload, PaginatedResponse } from "@/api/types";

export async function listCandidates(emailFilter?: string, isWithdrawn?: boolean): Promise<CandidateRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (emailFilter) params.set("email", emailFilter);
  if (isWithdrawn !== undefined) params.set("is_withdrawn", String(isWithdrawn));
  const response = await apiFetch<PaginatedResponse<CandidateRead>>(`/candidates?${params.toString()}`);
  return response.items;
}

export async function getCandidate(id: string): Promise<CandidateRead> {
  return apiFetch<CandidateRead>(`/candidates/${id}`);
}

export async function withdrawCandidate(id: string, payload: CandidateWithdrawPayload): Promise<CandidateRead> {
  return apiFetch<CandidateRead>(`/candidates/${id}/withdraw`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createCandidate(payload: CandidateCreatePayload): Promise<CandidateRead> {
  return apiFetch<CandidateRead>("/candidates", { method: "POST", body: JSON.stringify(payload) });
}

export async function uploadResume(id: string, file: File): Promise<CandidateRead> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<CandidateRead>(`/candidates/${id}/resume`, { method: "POST", body: formData });
}

/** Fetches the resume PDF as a Blob (auth-header-carrying) and triggers a
 * browser download/view -- a plain <a href> can't carry the Bearer token. */
export async function downloadResume(id: string, filename: string): Promise<void> {
  const blob = await apiFetchBlob(`/candidates/${id}/resume`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
