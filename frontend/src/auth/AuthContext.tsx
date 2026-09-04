import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import * as authApi from "@/api/auth";
import { configureAuth } from "@/api/client";
import type { Permission, UserRead, UserSelfUpdatePayload } from "@/api/types";
import { getUserPermissions, updateOwnProfile } from "@/api/users";

// Audit M1 (2026-09-04): the refresh token is an HttpOnly, SameSite=Strict
// cookie on the API host, set and rotated by the backend and never visible
// to script. Nothing about the session is written to localStorage or
// sessionStorage any more; the only client-side session state is the
// in-memory access token below. "Is there a session?" is answered by
// asking the server (one /auth/refresh on load), not by looking in storage.

interface AuthContextValue {
  user: UserRead | null;
  isLoading: boolean;
  // Set from the login/otp-verify/refresh response's own must_change_password
  // (and by client.ts's onPasswordChangeRequired hook when the flag gets set
  // mid-session, e.g. a Super Admin reset this user's password from another
  // session) -- ProtectedRoute redirects to /set-new-password while this is
  // true, and refuses to route anywhere else until it's cleared.
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestOtp: (email: string) => Promise<void>;
  loginWithOtp: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  // Called by SetNewPasswordPage after a successful self-service password
  // change (PATCH /users/me) -- updates the cached profile and clears the
  // forced-change flag so ProtectedRoute lets the user through again.
  completePasswordChange: (updatedUser: UserRead) => void;
  // The one way to PATCH /users/me from the app. A password change ends
  // EVERY session server-side, this one included (audit M3), so when the
  // payload carries a password this signs in again with it straight after
  // -- behind a gate that makes any concurrent silent refresh wait for the
  // new session instead of failing on the revoked cookie. Returns the
  // updated profile, which it has also applied to `user`. Optional for the
  // same reason as hasPermission below (the many test stubs of useAuth);
  // the real provider always supplies it.
  saveOwnProfile?: (payload: UserSelfUpdatePayload) => Promise<UserRead>;
  // Bug fix (2026-08-24): nav visibility previously only ever checked
  // user.role against a hardcoded allowlist (AppShell.tsx's
  // visibleForRoles), which meant an individually-granted permission from
  // the Permission Matrix (e.g. a RECRUITMENT_COORDINATOR given
  // MANAGE_USERS) had zero effect on whether that user could even SEE the
  // relevant nav link -- the backend correctly allowed the API call, but
  // the frontend never routed them there. hasPermission consults the
  // user's actual granted permissions (GET /users/{id}/permissions,
  // self-readable per that endpoint's own RBAC) so nav items can opt into
  // permission-based visibility (AppShell.tsx's new visibleForPermission)
  // in addition to the existing role-based visibleForRoles, without
  // changing how any already-working role-based item behaves. Optional
  // (not every test mock across this app's ~37 files that stub useAuth's
  // return value cares about it) -- the real AuthProvider below always
  // supplies a real function; call sites use `hasPermission?.(x) ?? false`.
  hasPermission?: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // SUPER_ADMIN is never represented by stored grant rows (has_permission's
  // backend bypass is unconditional for that role, see
  // app/services/permissions.py) -- fetching would just return an empty
  // list, so hasPermission special-cases the role directly instead of
  // relying on this array for it.
  const [permissions, setPermissions] = useState<Permission[]>([]);

  async function loadPermissions(loadedUser: UserRead) {
    if (loadedUser.role === "SUPER_ADMIN" || loadedUser.role === "CANDIDATE") {
      setPermissions([]);
      return;
    }
    try {
      const result = await getUserPermissions(loadedUser.id);
      setPermissions(result.permissions);
    } catch {
      // Non-fatal -- worst case, permission-gated nav items some role
      // wouldn't otherwise see stay hidden, same as before this fetch existed.
      setPermissions([]);
    }
  }
  // In-memory only -- the access token intentionally never touches
  // localStorage/sessionStorage (see Foundation-phase plan's token-storage
  // decision). A ref, not state, because client.ts's configureAuth hooks
  // read it from outside React's render cycle and must always see the
  // latest value, not a stale closure over one render's state.
  const accessTokenRef = useRef<string | null>(null);
  // Refresh tokens rotate server-side on every use: the presented cookie is
  // revoked and a new one set. Two refreshes in flight at once would
  // therefore present the same cookie and the second would be refused,
  // logging the user out -- so concurrent callers (several 401-retries at
  // once, React StrictMode's double-mounted bootstrap in dev) share ONE
  // in-flight request.
  const inFlightRefreshRef = useRef<Promise<string | null> | null>(null);

  function refreshAccessToken(): Promise<string | null> {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;
    const attempt = (async () => {
      try {
        const tokens = await authApi.refresh();
        accessTokenRef.current = tokens.access_token;
        setMustChangePassword(tokens.must_change_password);
        return tokens.access_token;
      } catch {
        // No live session (no cookie, or an expired/revoked one -- the
        // backend has already cleared it). A normal logged-out state.
        accessTokenRef.current = null;
        setUser(null);
        return null;
      } finally {
        inFlightRefreshRef.current = null;
      }
    })();
    inFlightRefreshRef.current = attempt;
    return attempt;
  }

  function clearSession() {
    accessTokenRef.current = null;
    setUser(null);
    setMustChangePassword(false);
    setPermissions([]);
  }

  useEffect(() => {
    configureAuth({
      getAccessToken: () => accessTokenRef.current,
      setAccessToken: (token) => {
        accessTokenRef.current = token;
      },
      refreshAccessToken,
      onAuthFailure: clearSession,
      onPasswordChangeRequired: () => setMustChangePassword(true),
    });

    // Restore a session on page load by asking the server: the browser
    // attaches the HttpOnly refresh cookie if it has one. A 401 (no cookie,
    // or an expired/revoked one) is a normal logged-out state, not an error
    // to surface.
    (async () => {
      const token = await refreshAccessToken();
      if (token) {
        try {
          const restoredUser = await authApi.getMe();
          setUser(restoredUser);
          await loadPermissions(restoredUser);
        } catch {
          clearSession();
        }
      }
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyTokens(tokens: Awaited<ReturnType<typeof authApi.login>>) {
    // The refresh cookie arrived on the same response; the browser holds it.
    accessTokenRef.current = tokens.access_token;
    setMustChangePassword(tokens.must_change_password);
    const loggedInUser = await authApi.getMe();
    setUser(loggedInUser);
    await loadPermissions(loggedInUser);
  }

  async function login(email: string, password: string) {
    await applyTokens(await authApi.login(email, password));
  }

  // Email one-time-passcode login, added 2026-08-06 -- kept alongside
  // password auth as an alternative flow, not a replacement (see
  // app/api/v1/routers/auth.py's own docstring). requestOtp is a
  // fire-and-forget step (always resolves; the backend never reveals
  // whether the email is registered) -- loginWithOtp is what actually
  // establishes the session, same shape as password login.
  async function requestOtp(email: string) {
    await authApi.requestOtp(email);
  }

  async function loginWithOtp(email: string, code: string) {
    await applyTokens(await authApi.verifyOtp(email, code));
  }

  async function logout() {
    try {
      // Revokes the cookie's token server-side and clears the cookie.
      await authApi.logout();
    } catch {
      // Best-effort -- still clear local state even if the server call fails.
    }
    clearSession();
  }

  function completePasswordChange(updatedUser: UserRead) {
    setUser(updatedUser);
    setMustChangePassword(false);
  }

  async function saveOwnProfile(payload: UserSelfUpdatePayload): Promise<UserRead> {
    if (!payload.password) {
      const updated = await updateOwnProfile(payload);
      setUser(updated);
      return updated;
    }
    // Gate first, then change, then sign in again. From the moment the
    // server commits the change, every existing token of this user is dead;
    // any request that 401s meanwhile lands in refreshAccessToken, which
    // hands back this promise instead of presenting the revoked cookie.
    let release!: (token: string | null) => void;
    const gate = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    inFlightRefreshRef.current = gate;
    try {
      const updated = await updateOwnProfile(payload);
      const tokens = await authApi.login(updated.email, payload.password);
      accessTokenRef.current = tokens.access_token;
      setMustChangePassword(tokens.must_change_password);
      setUser(updated);
      release(tokens.access_token);
      return updated;
    } catch (err) {
      release(accessTokenRef.current);
      throw err;
    } finally {
      inFlightRefreshRef.current = null;
    }
  }

  function hasPermission(permission: Permission): boolean {
    if (!user) return false;
    if (user.role === "SUPER_ADMIN") return true;
    return permissions.includes(permission);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        mustChangePassword,
        login,
        requestOtp,
        loginWithOtp,
        logout,
        completePasswordChange,
        saveOwnProfile,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
