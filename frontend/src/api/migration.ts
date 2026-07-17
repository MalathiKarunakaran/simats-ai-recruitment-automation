import { apiFetch, apiFetchBlob } from "@/api/client";
import type { MigrationImportResponse, TrackerImportResponse } from "@/api/types";

export async function importLegacyVacancies(file: File): Promise<MigrationImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<MigrationImportResponse>("/migration/import-legacy-vacancies", {
    method: "POST",
    body: formData,
  });
}

/** Downloads the real generated template (not a client-side stub) so its
 * Master Lists sheet and Excel dropdown data-validation survive. Same
 * Blob-download pattern as downloadResume/downloadReportExport. */
export async function downloadTrackerTemplate(): Promise<void> {
  const blob = await apiFetchBlob("/migration/tracker-template");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "SIMATS_Recruitment_Tracker_TEMPLATE.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export async function importTrackerWorkbook(file: File, includeSample = false): Promise<TrackerImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const query = includeSample ? "?include_sample=true" : "";
  return apiFetch<TrackerImportResponse>(`/migration/import-tracker-workbook${query}`, {
    method: "POST",
    body: formData,
  });
}
