import { apiFetch } from "@/api/client";
import type {
  DepartmentRoomAllotmentPayload,
  EmployeeRead,
  HandoverToHodPayload,
  JoiningDocumentRead,
  JoiningDocumentUpdatePayload,
  JoiningRecordRead,
  OrientationCompletePayload,
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

export async function allotDepartmentRoom(
  applicationId: string,
  payload: DepartmentRoomAllotmentPayload,
): Promise<JoiningRecordRead> {
  return apiFetch<JoiningRecordRead>(`/applications/${applicationId}/joining/allot-department-room`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function completeOrientation(
  applicationId: string,
  payload: OrientationCompletePayload,
): Promise<JoiningRecordRead> {
  return apiFetch<JoiningRecordRead>(`/applications/${applicationId}/joining/complete-orientation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function handOverToHod(applicationId: string, payload: HandoverToHodPayload): Promise<EmployeeRead> {
  return apiFetch<EmployeeRead>(`/applications/${applicationId}/joining/hand-over-to-hod`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
