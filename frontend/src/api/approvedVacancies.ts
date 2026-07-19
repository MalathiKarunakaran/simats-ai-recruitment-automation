import { apiFetch } from "@/api/client";
import type { ApprovedVacancyRead, HiringSlotRead, PaginatedResponse } from "@/api/types";

export async function listApprovedVacancies(): Promise<ApprovedVacancyRead[]> {
  const response = await apiFetch<PaginatedResponse<ApprovedVacancyRead>>("/approved-vacancies?limit=200");
  return response.items;
}

export async function getApprovedVacancyForRequest(vacancyRequestId: string): Promise<ApprovedVacancyRead | null> {
  const response = await apiFetch<PaginatedResponse<ApprovedVacancyRead>>(
    `/approved-vacancies?vacancy_request_id=${vacancyRequestId}&limit=1`,
  );
  return response.items[0] ?? null;
}

export async function listHiringSlots(approvedVacancyId: string): Promise<HiringSlotRead[]> {
  const response = await apiFetch<PaginatedResponse<HiringSlotRead>>(
    `/approved-vacancies/${approvedVacancyId}/hiring-slots?limit=200`,
  );
  return response.items;
}
