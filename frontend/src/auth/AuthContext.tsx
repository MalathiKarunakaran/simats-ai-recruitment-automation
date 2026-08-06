import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import * as authApi from "@/api/auth";
import { configureAuth } from "@/api/client";
import type { UserRead } from "@/api/types";

const REFRESH_TOKEN_STORAGE_KEY = "simats_refresh_token";

interface AuthContextValue {
  user: UserRead | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestOtp: (email: string) => Promise<void>;
  loginWithOtp: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // In-memory only -- the access token intentionally never touches
  // localStorage/sessionStorage (see Foundation-phase plan's token-storage
  // decision). A ref, not state, because client.ts's configureAuth hooks
  // read it from outside React's render cycle and must always see the
  // latest value, not a stale closure over one render's state.
  const accessTokenRef = useRef<string | null>(null);

  async function refreshAccessToken(): Promise<string | null> {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (!storedRefreshToken) return null;
    try {
      const tokens = await authApi.refresh(storedRefreshToken);
      accessTokenRef.current = tokens.access_token;
      // Refresh tokens rotate server-side on every use -- the old one is
      // revoked, so the latest one must always replace what's stored.
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refresh_token);
      return tokens.access_token;
    } catch {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      accessTokenRef.current = null;
      setUser(null);
      return null;
    }
  }

  function clearSession() {
    accessTokenRef.current = null;
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    setUser(null);
  }

  useEffect(() => {
    configureAuth({
      getAccessToken: () => accessTokenRef.current,
      setAccessToken: (token) => {
        accessTokenRef.current = token;
      },
      refreshAccessToken,
      onAuthFailure: clearSession,
    });

    // Restore a session on page load from the persisted refresh token, if
    // any -- a missing/expired one is a normal logged-out state, not an
    // error to surface.
    (async () => {
      const token = await refreshAccessToken();
      if (token) {
        try {
          setUser(await authApi.getMe());
        } catch {
          clearSession();
        }
      }
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyTokens(tokens: Awaited<ReturnType<typeof authApi.login>>) {
    accessTokenRef.current = tokens.access_token;
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refresh_token);
    setUser(await authApi.getMe());
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
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (storedRefreshToken) {
      try {
        await authApi.logout(storedRefreshToken);
      } catch {
        // Best-effort -- still clear local state even if the server call fails.
      }
    }
    clearSession();
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, requestOtp, loginWithOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
