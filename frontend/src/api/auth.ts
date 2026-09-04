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

export async function requestOtp(email: string): Promise<void> {
  await publicFetch<{ detail: string }>("/auth/otp-request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, code: string): Promise<TokenPair> {
  return publicFetch<TokenPair>("/auth/otp-verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

/** The refresh token is the HttpOnly cookie the browser attaches on its own
 * (client.ts sends credentials); there is no body. A 401 here is the normal
 * "no live session" answer, and the backend clears the stale cookie with it. */
export async function refresh(): Promise<TokenPair> {
  return publicFetch<TokenPair>("/auth/refresh", { method: "POST" });
}

/** Revokes the cookie's refresh token server-side and clears the cookie. */
export async function logout(): Promise<void> {
  await apiFetch<void>("/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<UserRead> {
  return apiFetch<UserRead>("/auth/me");
}

export interface LoginOptions {
  password_login: boolean;
  otp_email_login: boolean;
}

/** Which sign-in methods the server can actually honour right now. OTP is
 * reported unavailable when production has no email delivery configured,
 * so the page never offers a code it cannot send. */
export async function getLoginOptions(): Promise<LoginOptions> {
  return publicFetch<LoginOptions>("/auth/login-options", { method: "GET" });
}
