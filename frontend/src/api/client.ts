// Typed fetch wrapper. Handles the Authorization header and a single
// silent-refresh-then-retry on a 401, per the Foundation-phase plan's auth
// design: the access token lives only in memory (via AuthContext, wired in
// through configureAuth below -- never read/written here to localStorage),
// so this module needs a small indirection to reach it without a circular
// import between client.ts and AuthContext.tsx.

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface AuthHooks {
  getAccessToken: () => string | null;
  setAccessToken: (token: string | null) => void;
  refreshAccessToken: () => Promise<string | null>;
  onAuthFailure: () => void;
}

let authHooks: AuthHooks | null = null;

export function configureAuth(hooks: AuthHooks) {
  authHooks = hooks;
}

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : JSON.stringify(item)))
        .join("; ");
    }
  }
  return "Request failed";
}

async function rawRequest(path: string, options: RequestInit): Promise<Response> {
  // Skip the default JSON content-type for FormData bodies -- the browser
  // must set its own multipart boundary, which a fixed header would clobber.
  const isFormData = options.body instanceof FormData;
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
}

/** For authenticated calls. Never used by login/refresh/logout themselves
 * (those are the refresh mechanism, not consumers of it -- see auth.ts). */
export async function apiFetch<T>(path: string, options: RequestInit = {}, _isRetry = false): Promise<T> {
  const token = authHooks?.getAccessToken();
  const response = await rawRequest(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && !_isRetry && authHooks) {
    const newToken = await authHooks.refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, options, true);
    }
    authHooks.onAuthFailure();
    throw new ApiError(401, "Session expired");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, extractErrorMessage(body));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/** Like apiFetch, but returns the raw response body as a Blob (e.g. resume
 * PDF downloads) instead of parsing JSON. */
export async function apiFetchBlob(path: string, options: RequestInit = {}, _isRetry = false): Promise<Blob> {
  const token = authHooks?.getAccessToken();
  const response = await rawRequest(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && !_isRetry && authHooks) {
    const newToken = await authHooks.refreshAccessToken();
    if (newToken) {
      return apiFetchBlob(path, options, true);
    }
    authHooks.onAuthFailure();
    throw new ApiError(401, "Session expired");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, extractErrorMessage(body));
  }

  return response.blob();
}

/** Unauthenticated / self-contained requests -- login, and the raw refresh
 * call itself (which must not recurse through apiFetch's own 401 handler). */
export async function publicFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await rawRequest(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, extractErrorMessage(body));
  }
  return response.json() as Promise<T>;
}
