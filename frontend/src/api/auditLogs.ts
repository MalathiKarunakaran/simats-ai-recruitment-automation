import { apiFetch } from "@/api/client";
import type { AuditLogRead, PaginatedResponse } from "@/api/types";

interface ListAuditLogsFilters {
  entityType?: string | null;
  campusId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Phase H (glowing-zooming-hamming.md) -- entity_id filter, added for the
  // Sanctioned Strength drawer's Audit Log tab (one exact SanctionedStrength
  // record's own trail, not the whole entity_type). Mirrors the backend's
  // new entity_id param on GET /audit-logs (app/api/v1/routers/audit_logs.py).
  entityId?: string | null;
}

export async function listAuditLogs(filters: ListAuditLogsFilters = {}): Promise<AuditLogRead[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.entityType) params.set("entity_type", filters.entityType);
  if (filters.campusId) params.set("campus_id", filters.campusId);
  if (filters.startDate) params.set("start_date", filters.startDate);
  if (filters.endDate) params.set("end_date", filters.endDate);
  if (filters.entityId) params.set("entity_id", filters.entityId);
  const response = await apiFetch<PaginatedResponse<AuditLogRead>>(`/audit-logs?${params.toString()}`);
  return response.items;
}
