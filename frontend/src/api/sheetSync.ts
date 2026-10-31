import { apiFetch, apiFetchBlob } from "@/api/client";
import type { SheetSyncStatusItem } from "@/api/types";

// app/api/v1/routers/sheet_sync.py -- both GETs are SUPER_ADMIN only.
// Read-only: the sync itself is pushed by the Google Apps Script.

export async function listSheetSyncRuns(): Promise<SheetSyncStatusItem[]> {
  return apiFetch<SheetSyncStatusItem[]>("/sheet-sync/runs");
}

export async function downloadFlaggedRows(runId: string): Promise<void> {
  const blob = await apiFetchBlob(`/sheet-sync/runs/${encodeURIComponent(runId)}/flagged.xlsx`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "flagged-rows.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}
