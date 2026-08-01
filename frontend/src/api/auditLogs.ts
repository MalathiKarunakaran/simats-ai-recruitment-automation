import { apiFetch } from "@/api/client";
import type { AuditLogRead, PaginatedResponse } from "@/api/types";

interface ListAuditLogsFilters {
  entityType?: string | null;
  campusId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export async function listAuditLogs(filters: ListAuditLogsFilters = {}): Promise<AuditLogRead[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.entityType) params.set("entity_type", filters.entityType);
  if (filters.campusId) params.set("campus_id", filters.campusId);
  if (filters.startDate) params.set("start_date", filters.startDate);
  if (filters.endDate) params.set("end_date", filters.endDate);
  const response = await apiFetch<PaginatedResponse<AuditLogRead>>(`/audit-logs?${params.toString()}`);
  return response.items;
}
