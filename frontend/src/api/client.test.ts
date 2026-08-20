import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, configureAuth } from "@/api/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches the current access token and returns the parsed body on success", async () => {
    configureAuth({
      getAccessToken: () => "token-123",
      setAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      onAuthFailure: vi.fn(),
      onPasswordChangeRequired: vi.fn(),
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await apiFetch<{ ok: boolean }>("/some-path");

    expect(result).toEqual({ ok: true });
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
  });

  it("on a 401, refreshes exactly once and retries, then returns the retried response", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue("new-token");
    const onAuthFailure = vi.fn();
    configureAuth({
      getAccessToken: () => "expired-token",
      setAccessToken: vi.fn(),
      refreshAccessToken,
      onAuthFailure,
      onPasswordChangeRequired: vi.fn(),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiFetch<{ ok: boolean }>("/some-path");

    expect(result).toEqual({ ok: true });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("logs out (does not loop) when refresh itself cannot produce a new token", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue(null);
    const onAuthFailure = vi.fn();
    configureAuth({
      getAccessToken: () => "expired-token",
      setAccessToken: vi.fn(),
      refreshAccessToken,
      onAuthFailure,
      onPasswordChangeRequired: vi.fn(),
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { detail: "expired" }));

    await expect(apiFetch("/some-path")).rejects.toBeInstanceOf(ApiError);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("normalizes a FastAPI validation-error array detail into one message", async () => {
    configureAuth({
      getAccessToken: () => null,
      setAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      onAuthFailure: vi.fn(),
      onPasswordChangeRequired: vi.fn(),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(422, { detail: [{ msg: "field required", loc: ["body", "email"] }] }),
    );

    await expect(apiFetch("/some-path")).rejects.toMatchObject({ message: "field required" });
  });

  it("fires onPasswordChangeRequired (but still throws) on a 403 PASSWORD_CHANGE_REQUIRED body", async () => {
    const onPasswordChangeRequired = vi.fn();
    configureAuth({
      getAccessToken: () => "token-123",
      setAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      onAuthFailure: vi.fn(),
      onPasswordChangeRequired,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(403, { detail: "PASSWORD_CHANGE_REQUIRED" }));

    await expect(apiFetch("/vacancy-requests")).rejects.toBeInstanceOf(ApiError);

    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPasswordChangeRequired for an unrelated 403", async () => {
    const onPasswordChangeRequired = vi.fn();
    configureAuth({
      getAccessToken: () => "token-123",
      setAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      onAuthFailure: vi.fn(),
      onPasswordChangeRequired,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(403, { detail: "Not permitted" }));

    await expect(apiFetch("/vacancy-requests")).rejects.toBeInstanceOf(ApiError);

    expect(onPasswordChangeRequired).not.toHaveBeenCalled();
  });
});
