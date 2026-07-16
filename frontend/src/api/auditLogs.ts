import { apiFetch } from "@/api/client";
import type { AuditLogRead, PaginatedResponse } from "@/api/types";

interface ListAuditLogsFilters {
  entityType?: string | null;
}

export async function listAuditLogs(filters: ListAuditLogsFilters = {}): Promise<AuditLogRead[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.entityType) params.set("entity_type", filters.entityType);
  const response = await apiFetch<PaginatedResponse<AuditLogRead>>(`/audit-logs?${params.toString()}`);
  return response.items;
}
