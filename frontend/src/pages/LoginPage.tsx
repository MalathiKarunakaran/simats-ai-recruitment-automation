import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Email + one-time code is the default sign-in flow (2026-08-06, per the
// user's request); password stays available as a fallback -- see
// AuthContext.tsx's own comment on why both still exist.
type Mode = "otp-email" | "otp-code" | "password";

export function LoginPage() {
  const { user, isLoading, login, requestOtp, loginWithOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>("otp-email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoading && user) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";
    return <Navigate to={redirectTo} replace />;
  }

  function resetMessages() {
    setError(null);
    setInfo(null);
  }

  async function sendCode() {
    resetMessages();
    setIsSubmitting(true);
    try {
      await requestOtp(email);
      setMode("otp-code");
      setInfo("If that email is registered, a login code has been sent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a login code");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    void sendCode();
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);
    try {
      await loginWithOtp(email, code);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Incorrect or expired code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    resetMessages();
    setCode("");
    setPassword("");
    setMode(next);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Sign in to SIMATS Recruitment</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "otp-email" ? (
            <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send login code"}
              </Button>
              <button
                type="button"
                onClick={() => switchMode("password")}
                className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                Sign in with a password instead
              </button>
            </form>
          ) : null}

          {mode === "otp-code" ? (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span>.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="otp_code">Login code</Label>
                <Input
                  id="otp_code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={isSubmitting || code.length !== 6}>
                {isSubmitting ? "Verifying…" : "Verify & sign in"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => switchMode("otp-email")}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void sendCode()}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  Resend code
                </button>
              </div>
            </form>
          ) : null}

          {mode === "password" ? (
            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password_email">Email</Label>
                <Input
                  id="password_email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => switchMode("otp-email")}
                className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                Sign in with a code instead
              </button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
