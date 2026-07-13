import { apiFetch, publicFetch } from "@/api/client";
import type { TokenPair, UserRead } from "@/api/types";

export async function login(email: string, password: string): Promise<TokenPair> {
  const body = new URLSearchParams({ username: email, password });
  return publicFetch<TokenPair>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  return publicFetch<TokenPair>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await apiFetch<void>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function getMe(): Promise<UserRead> {
  return apiFetch<UserRead>("/auth/me");
}
