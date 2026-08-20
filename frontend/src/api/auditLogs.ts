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
  // User Administration redesign -- one actor's own trail (UserDetailPage's
  // Recent Activity section). Mirrors the backend's actor_user_id param on
  // GET /audit-logs (app/api/v1/routers/audit_logs.py).
  actorUserId?: string | null;
  // Overrides the default page size of 100 -- e.g. Recent Activity only
  // wants the 5 most recent entries for one actor.
  limit?: number;
}

export async function listAuditLogs(filters: ListAuditLogsFilters = {}): Promise<AuditLogRead[]> {
  const params = new URLSearchParams({ limit: String(filters.limit ?? 100) });
  if (filters.entityType) params.set("entity_type", filters.entityType);
  if (filters.campusId) params.set("campus_id", filters.campusId);
  if (filters.startDate) params.set("start_date", filters.startDate);
  if (filters.endDate) params.set("end_date", filters.endDate);
  if (filters.entityId) params.set("entity_id", filters.entityId);
  if (filters.actorUserId) params.set("actor_user_id", filters.actorUserId);
  const response = await apiFetch<PaginatedResponse<AuditLogRead>>(`/audit-logs?${params.toString()}`);
  return response.items;
}
