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
  // Fired on any 403 whose body is {"detail": "PASSWORD_CHANGE_REQUIRED"} --
  // the backend rejects every request but a small allow-list (see
  // handlePasswordChangeRequired below) with this once a user's
  // must_change_password flag is set, even mid-session (e.g. a Super Admin
  // reset their password from another session). Mirrors onAuthFailure's
  // role for 401s: AuthContext reacts by forcing the app into the
  // /set-new-password screen.
  onPasswordChangeRequired: () => void;
}

const PASSWORD_CHANGE_REQUIRED_DETAIL = "PASSWORD_CHANGE_REQUIRED";

function handlePasswordChangeRequired(status: number, body: unknown) {
  if (
    status === 403 &&
    authHooks &&
    body &&
    typeof body === "object" &&
    (body as { detail?: unknown }).detail === PASSWORD_CHANGE_REQUIRED_DETAIL
  ) {
    authHooks.onPasswordChangeRequired();
  }
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

// Audit M1 (2026-09-04): the refresh token is an HttpOnly cookie scoped to
// the API's /auth path, so every request goes out with credentials (the
// browser only attaches the cookie where its path matches -- refresh and
// logout) and with the anti-CSRF header those two endpoints require. The
// header is a custom one on purpose: an HTML form cannot send it, and a
// cross-origin script can only send it after a CORS preflight, which the
// backend's origin allow-list refuses for anyone but this app.
export const CSRF_HEADER_NAME = "X-Requested-With";
export const CSRF_HEADER_VALUE = "XMLHttpRequest";

async function rawRequest(path: string, options: RequestInit): Promise<Response> {
  // Skip the default JSON content-type for FormData bodies -- the browser
  // must set its own multipart boundary, which a fixed header would clobber.
  const isFormData = options.body instanceof FormData;
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
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
    handlePasswordChangeRequired(response.status, body);
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
    handlePasswordChangeRequired(response.status, body);
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
