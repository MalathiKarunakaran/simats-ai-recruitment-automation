import { apiFetch } from "@/api/client";
import type { PaginatedResponse, UserRead } from "@/api/types";

export async function listUsers(): Promise<UserRead[]> {
  const response = await apiFetch<PaginatedResponse<UserRead>>("/users?limit=200");
  return response.items;
}
