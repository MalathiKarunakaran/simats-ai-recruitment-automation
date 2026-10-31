import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  AppointmentOrderRead,
  DepartmentOptionsResponse,
  DepartmentRoomAllotmentPayload,
  EmployeeRead,
  HandoverToHodPayload,
  HodRecommendation,
  HodReviewHistory,
  HodReviewRead,
  JoiningDocumentRead,
  JoiningDocumentUpdatePayload,
  JoiningRecordRead,
  OnboardingProbationRow,
  OrientationCompletePayload,
  PaginatedResponse,
  PermanentOrderPayload,
  PermanentOrderRead,
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

/** Stores the document's file (PDF/JPEG/PNG) and marks the row RECEIVED --
 * POST /joining-documents/{id}/file (2026-09-07). */
export async function uploadJoiningDocumentFile(documentId: string, file: File): Promise<JoiningDocumentRead> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<JoiningDocumentRead>(`/joining-documents/${documentId}/file`, { method: "POST", body: formData });
}

/** Fetches the stored file as a Blob (the request must carry the Bearer
 * token, so a plain <a href> cannot do it) and opens it in a new tab. */
export async function openJoiningDocumentFile(documentId: string): Promise<void> {
  const blob = await apiFetchBlob(`/joining-documents/${documentId}/file`);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // Give the new tab a moment to take the object URL before it is revoked.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

// --- Provisional appointment order (docs/specs/provisional-order-and-allotment.md)

// Mirrors app/schemas/joining.py::ProvisionalOrderCreate. `address` left out
// means the candidate's own; an empty string prints none.
export interface ProvisionalOrderPayload {
  order_date?: string | null;
  address?: string | null;
}

export async function issueProvisionalOrder(
  applicationId: string,
  payload: ProvisionalOrderPayload = {},
): Promise<AppointmentOrderRead> {
  return apiFetch<AppointmentOrderRead>(`/applications/${applicationId}/provisional-order`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getProvisionalOrder(applicationId: string): Promise<AppointmentOrderRead> {
  return apiFetch<AppointmentOrderRead>(`/applications/${applicationId}/provisional-order`);
}

async function openBlob(path: string): Promise<void> {
  const blob = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function openProvisionalOrderLetter(applicationId: string): Promise<void> {
  return openBlob(`/applications/${applicationId}/provisional-order/letter.pdf`);
}

export function openProvisionalOrderSignedCopy(applicationId: string): Promise<void> {
  return openBlob(`/applications/${applicationId}/provisional-order/signed-copy`);
}

export async function uploadProvisionalOrderSignedCopy(
  applicationId: string,
  file: File,
): Promise<AppointmentOrderRead> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<AppointmentOrderRead>(`/applications/${applicationId}/provisional-order/signed-copy`, {
    method: "POST",
    body: formData,
  });
}

export async function getDepartmentOptions(applicationId: string): Promise<DepartmentOptionsResponse> {
  return apiFetch<DepartmentOptionsResponse>(`/applications/${applicationId}/department-options`);
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

// --- HOD review + permanent order (docs/specs/hod-review-and-permanent-order.md)

export interface HodReviewPayload {
  hod_name: string;
  review_date: string;
  recommendation: HodRecommendation;
  new_probation_end_date?: string | null;
  remarks?: string | null;
  file?: File | null;
}

/** Multipart: the signed review is optional. Empty optional fields are left
 * out rather than sent as "". */
export async function recordHodReview(applicationId: string, payload: HodReviewPayload): Promise<HodReviewRead> {
  const formData = new FormData();
  formData.append("hod_name", payload.hod_name);
  formData.append("review_date", payload.review_date);
  formData.append("recommendation", payload.recommendation);
  if (payload.new_probation_end_date) formData.append("new_probation_end_date", payload.new_probation_end_date);
  if (payload.remarks) formData.append("remarks", payload.remarks);
  if (payload.file) formData.append("file", payload.file);
  return apiFetch<HodReviewRead>(`/applications/${applicationId}/hod-reviews`, { method: "POST", body: formData });
}

export async function listHodReviews(applicationId: string): Promise<HodReviewHistory> {
  return apiFetch<HodReviewHistory>(`/applications/${applicationId}/hod-reviews`);
}

export function openHodReviewFile(applicationId: string, reviewId: string): Promise<void> {
  return openBlob(`/applications/${applicationId}/hod-reviews/${reviewId}/file`);
}

export async function recordPermanentOrder(
  applicationId: string,
  payload: PermanentOrderPayload,
): Promise<PermanentOrderRead> {
  return apiFetch<PermanentOrderRead>(`/applications/${applicationId}/permanent-order`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getPermanentOrder(applicationId: string): Promise<PermanentOrderRead> {
  return apiFetch<PermanentOrderRead>(`/applications/${applicationId}/permanent-order`);
}

export async function uploadPermanentOrderFile(applicationId: string, file: File): Promise<PermanentOrderRead> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<PermanentOrderRead>(`/applications/${applicationId}/permanent-order/file`, {
    method: "POST",
    body: formData,
  });
}

export function openPermanentOrderFile(applicationId: string): Promise<void> {
  return openBlob(`/applications/${applicationId}/permanent-order/file`);
}

export async function listOnboardingProbation(): Promise<OnboardingProbationRow[]> {
  return apiFetch<OnboardingProbationRow[]>("/onboarding/probation");
}
