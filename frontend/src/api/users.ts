import { apiFetch } from "@/api/client";
import type { PaginatedResponse, UserCreatePayload, UserRead, UserUpdatePayload } from "@/api/types";

export async function listUsers(): Promise<UserRead[]> {
  const response = await apiFetch<PaginatedResponse<UserRead>>("/users?limit=200");
  return response.items;
}

export async function getUser(id: string): Promise<UserRead> {
  return apiFetch<UserRead>(`/users/${id}`);
}

export async function createUser(payload: UserCreatePayload): Promise<UserRead> {
  return apiFetch<UserRead>("/users", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateUser(id: string, payload: UserUpdatePayload): Promise<UserRead> {
  return apiFetch<UserRead>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function deactivateUser(id: string): Promise<void> {
  await apiFetch<void>(`/users/${id}`, { method: "DELETE" });
}
