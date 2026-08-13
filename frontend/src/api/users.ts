import { apiFetch } from "@/api/client";
import type {
  CoordinatorCapabilitiesRead,
  CoordinatorCapability,
  PaginatedResponse,
  UserCreatePayload,
  UserRead,
  UserSelfUpdatePayload,
  UserUpdatePayload,
} from "@/api/types";

export async function listUsers(): Promise<UserRead[]> {
  const response = await apiFetch<PaginatedResponse<UserRead>>("/users?limit=200");
  return response.items;
}

export async function getOwnProfile(): Promise<UserRead> {
  return apiFetch<UserRead>("/users/me");
}

export async function updateOwnProfile(payload: UserSelfUpdatePayload): Promise<UserRead> {
  return apiFetch<UserRead>("/users/me", { method: "PATCH", body: JSON.stringify(payload) });
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

export async function getUserCapabilities(id: string): Promise<CoordinatorCapabilitiesRead> {
  return apiFetch<CoordinatorCapabilitiesRead>(`/users/${id}/capabilities`);
}

export async function setUserCapabilities(
  id: string,
  capabilities: CoordinatorCapability[],
): Promise<CoordinatorCapabilitiesRead> {
  return apiFetch<CoordinatorCapabilitiesRead>(`/users/${id}/capabilities`, {
    method: "PUT",
    body: JSON.stringify({ capabilities }),
  });
}
