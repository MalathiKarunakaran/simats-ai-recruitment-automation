import { apiFetch } from "@/api/client";
import type {
  EmployeeCreatePayload,
  EmployeeRead,
  JoiningDocumentRead,
  JoiningDocumentUpdatePayload,
  JoiningRecordRead,
  PaginatedResponse,
} from "@/api/types";

export async function getJoiningRecord(applicationId: string): Promise<JoiningRecordRead> {
  return apiFetch<JoiningRecordRead>(`/applications/${applicationId}/joining-record`);
}

export async function listJoiningDocuments(applicationId: string): Promise<JoiningDocumentRead[]> {
  const response = await apiFetch<PaginatedResponse<JoiningDocumentRead>>(
    `/applications/${applicationId}/joining-documents?limit=200`,
  );
  return response.items;
}

export async function updateJoiningDocument(
  documentId: string,
  payload: JoiningDocumentUpdatePayload,
): Promise<JoiningDocumentRead> {
  return apiFetch<JoiningDocumentRead>(`/joining-documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function markJoined(applicationId: string): Promise<JoiningRecordRead> {
  return apiFetch<JoiningRecordRead>(`/applications/${applicationId}/joining/mark-joined`, { method: "POST" });
}

export async function completeOnboarding(applicationId: string): Promise<JoiningRecordRead> {
  return apiFetch<JoiningRecordRead>(`/applications/${applicationId}/joining/complete-onboarding`, {
    method: "POST",
  });
}

export async function createEmployee(applicationId: string, payload: EmployeeCreatePayload): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/applications/${applicationId}/joining/create-employee`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
