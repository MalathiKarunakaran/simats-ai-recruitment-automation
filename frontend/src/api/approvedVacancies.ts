import { apiFetch } from "@/api/client";
import type { ApprovedVacancyRead, PaginatedResponse } from "@/api/types";

export async function listApprovedVacancies(): Promise<ApprovedVacancyRead[]> {
  const response = await apiFetch<PaginatedResponse<ApprovedVacancyRead>>("/approved-vacancies?limit=200");
  return response.items;
}
