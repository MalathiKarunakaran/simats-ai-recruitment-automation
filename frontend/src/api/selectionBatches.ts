import { apiFetch, apiFetchBlob } from "@/api/client";
import type {
  PaginatedResponse,
  SelectionBatch,
  SelectionBatchCreatePayload,
  SelectionBatchDetail,
  UniversityApprovalPayload,
} from "@/api/types";

// app/api/v1/routers/selection_batches.py -- every route is
// require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR).

export async function createSelectionBatch(payload: SelectionBatchCreatePayload): Promise<SelectionBatchDetail> {
  return apiFetch<SelectionBatchDetail>("/selection-batches", { method: "POST", body: JSON.stringify(payload) });
}

export async function listSelectionBatches(
  filters: { status?: string | null; limit?: number; offset?: number } = {},
): Promise<PaginatedResponse<SelectionBatch>> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 25));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.status) params.set("status", filters.status);
  return apiFetch<PaginatedResponse<SelectionBatch>>(`/selection-batches?${params}`);
}

export async function getSelectionBatch(id: string): Promise<SelectionBatchDetail> {
  return apiFetch<SelectionBatchDetail>(`/selection-batches/${encodeURIComponent(id)}`);
}

/** {entry_id: batch_no} for entries already in a batch that is not withdrawn. */
export async function getBatchMembership(entryIds: string[]): Promise<Record<string, string>> {
  if (entryIds.length === 0) return {};
  const params = new URLSearchParams();
  for (const id of entryIds) params.append("entry_ids", id);
  return apiFetch<Record<string, string>>(`/selection-batches/membership?${params}`);
}

export async function recordUniversityApproval(
  id: string,
  payload: UniversityApprovalPayload,
): Promise<SelectionBatchDetail> {
  return apiFetch<SelectionBatchDetail>(`/selection-batches/${encodeURIComponent(id)}/approval`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function withdrawSelectionBatch(id: string, reason?: string | null): Promise<SelectionBatchDetail> {
  return apiFetch<SelectionBatchDetail>(`/selection-batches/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

async function download(path: string, filename: string): Promise<void> {
  const blob = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadBatchExcel(id: string, batchNo: string): Promise<void> {
  await download(`/selection-batches/${encodeURIComponent(id)}/export.xlsx`, `simats-${batchNo}.xlsx`);
}

export async function downloadBatchPdf(id: string, batchNo: string): Promise<void> {
  await download(`/selection-batches/${encodeURIComponent(id)}/export.pdf`, `simats-${batchNo}.pdf`);
}
