import { apiFetch } from "@/api/client";
import type { ResumeScoreRead } from "@/api/types";

export async function screenApplication(applicationId: string): Promise<ResumeScoreRead> {
  return apiFetch<ResumeScoreRead>(`/applications/${applicationId}/screen`, { method: "POST" });
}

export async function getResumeScore(applicationId: string): Promise<ResumeScoreRead> {
  return apiFetch<ResumeScoreRead>(`/applications/${applicationId}/resume-score`);
}
