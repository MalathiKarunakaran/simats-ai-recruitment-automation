import { apiFetch } from "@/api/client";
import type { MigrationImportResponse } from "@/api/types";

export async function importLegacyVacancies(file: File): Promise<MigrationImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<MigrationImportResponse>("/migration/import-legacy-vacancies", {
    method: "POST",
    body: formData,
  });
}
