import { apiFetch } from "@/api/client";
import type { NotificationRead, PaginatedResponse } from "@/api/types";

export async function listNotifications(limit = 20): Promise<NotificationRead[]> {
  const response = await apiFetch<PaginatedResponse<NotificationRead>>(`/notifications?limit=${limit}`);
  return response.items;
}
