import { apiFetch } from "@/api/client";
import type {
  InterviewFeedbackCreatePayload,
  InterviewFeedbackRead,
  InterviewQuestionsResponse,
  InterviewScheduleCreatePayload,
  InterviewScheduleRead,
  InterviewScheduleStatus,
  InterviewScheduleUpdatePayload,
  PaginatedResponse,
} from "@/api/types";

interface ListInterviewsFilters {
  status?: InterviewScheduleStatus | null;
  applicationId?: string | null;
}

export async function listInterviews(filters: ListInterviewsFilters = {}): Promise<InterviewScheduleRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.status) params.set("status", filters.status);
  if (filters.applicationId) params.set("application_id", filters.applicationId);
  const response = await apiFetch<PaginatedResponse<InterviewScheduleRead>>(`/interviews?${params.toString()}`);
  return response.items;
}

export async function getInterview(id: string): Promise<InterviewScheduleRead> {
  return apiFetch<InterviewScheduleRead>(`/interviews/${id}`);
}

export async function createInterview(payload: InterviewScheduleCreatePayload): Promise<InterviewScheduleRead> {
  return apiFetch<InterviewScheduleRead>("/interviews", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateInterview(
  id: string,
  payload: InterviewScheduleUpdatePayload,
): Promise<InterviewScheduleRead> {
  return apiFetch<InterviewScheduleRead>(`/interviews/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function listInterviewFeedback(interviewId: string): Promise<InterviewFeedbackRead[]> {
  const response = await apiFetch<PaginatedResponse<InterviewFeedbackRead>>(
    `/interviews/${interviewId}/feedback?limit=200`,
  );
  return response.items;
}

export async function submitInterviewFeedback(
  interviewId: string,
  payload: InterviewFeedbackCreatePayload,
): Promise<InterviewFeedbackRead> {
  return apiFetch<InterviewFeedbackRead>(`/interviews/${interviewId}/feedback`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateInterviewQuestions(interviewId: string): Promise<InterviewQuestionsResponse> {
  return apiFetch<InterviewQuestionsResponse>(`/interviews/${interviewId}/generate-questions`, { method: "POST" });
}
