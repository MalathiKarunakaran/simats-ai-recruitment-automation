import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, Check, ClipboardList, ShieldCheck } from "lucide-react";

import simatsSeal from "@/assets/simats-seal.png";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

// Email + one-time code is the default sign-in flow (2026-08-06, per the
// user's request); password stays available as a fallback -- see
// AuthContext.tsx's own comment on why both still exist.
type Mode = "otp-email" | "otp-code" | "password";

// Split-screen enterprise redesign (2026-08-29). UI ONLY: every handler,
// mode transition, auth call and error string below is carried over verbatim
// from the previous single-card version -- `requestOtp`/`loginWithOtp`/
// `login` are called with the same arguments in the same order, and the
// three `Mode` values and their transitions are unchanged.
//
// Two deliberate omissions worth recording, both because the brief made them
// conditional:
//
// 1. **No "Forgot password?" link.** The brief said to add one "only if the
//    existing authentication supports it". It doesn't, end-to-end:
//    app/api/v1/routers/auth.py's `/password-reset-request` is an explicit
//    Phase 1 stub that only `print()`s the token to the server console (no
//    email delivery -- that's the Notification Agent's later phase), and
//    there is no /forgot-password route in App.tsx to land on. A link here
//    would send a locked-out user into a dead end, which is worse than not
//    offering it. Add it when email delivery lands.
//
// 2. **Button/link wording is unchanged** ("Send login code", not the
//    brief's "Send Login Code"; "Sign in with a password instead", not
//    "Sign in with password"). These exact strings are the accessible names
//    LoginPage.test.tsx queries by (getByRole("button", { name: ... })), and
//    they match this app's sentence-case convention everywhere else. The
//    visual treatment changed; the words didn't.
const HIGHLIGHTS = [
  { icon: ClipboardList, label: "Vacancy Management" },
  { icon: Briefcase, label: "Recruitment Tracking" },
  { icon: BarChart3, label: "Workforce Analytics" },
] as const;

/** Decorative background for the left panel -- an inline SVG rather than an
 * image asset so it inherits the panel's own colors, costs no extra request,
 * and can never load late/broken. Deliberately low-contrast and behind the
 * content (the brief: "subtle geometric pattern", "do NOT use a huge
 * illustration that distracts from login"). */
function GeometricPattern() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 400 600"
      fill="none"
    >
      <defs>
        <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0v40" stroke="currentColor" strokeWidth="0.5" fill="none" />
        </pattern>
      </defs>
      <rect width="400" height="600" fill="url(#login-grid)" />
      <circle cx="330" cy="90" r="120" stroke="currentColor" strokeWidth="1" />
      <circle cx="330" cy="90" r="78" stroke="currentColor" strokeWidth="1" />
      <circle cx="60" cy="500" r="150" stroke="currentColor" strokeWidth="1" />
      <circle cx="60" cy="500" r="96" stroke="currentColor" strokeWidth="1" />
      <path d="M0 330 L400 250" stroke="currentColor" strokeWidth="1" />
      <path d="M0 370 L400 290" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

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

  // role="alert" + aria-live so a screen reader announces a failed sign-in
  // attempt without the user having to go hunting for the message.
  const errorBanner = error ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
    >
      {error}
    </p>
  ) : null;

  return (
    <div className="grid min-h-screen lg:grid-cols-[45fr_55fr]">
      {/* LEFT 45% -- brand panel. Hidden below `lg` (the brief: tablet/mobile
          drop the illustration and show the centred card alone), so it never
          competes with the form for space on a small screen. */}
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(150deg,var(--brand-primary)_0%,#1e3a8a_55%,var(--brand-secondary)_140%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <GeometricPattern />

        <div className="relative flex items-center gap-3">
          <img
            src={simatsSeal}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full bg-white/95 p-1 shadow-lg"
          />
          <div>
            <p className="font-display text-xl leading-tight font-bold">SIMATS Recruitment</p>
            <p className="text-sm text-white/75">Saveetha Institute of Medical and Technical Sciences</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl leading-[1.15] font-bold">
            Hire the right people,
            <br />
            faster.
          </h1>
          <p className="mt-4 text-base text-white/80">Recruitment • Workforce • Vacancy Management</p>

          <ul className="mt-9 flex flex-col gap-3.5">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                <Icon className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
                <span className="text-[15px] font-medium text-white/95">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-sm text-white/70">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Secure access • Authorized users only
        </p>
      </aside>

      {/* RIGHT 55% -- the login card. */}
      <main className="flex flex-col items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="rounded-[20px] border border-border bg-card p-7 shadow-[0_10px_40px_-12px_rgb(15_23_42_/_0.18)] sm:p-9">
            <div className="flex flex-col items-center text-center">
              <img
                src={simatsSeal}
                alt="SIMATS"
                className="h-14 w-14 rounded-full ring-1 ring-border"
              />
              <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Welcome back</h2>
              <p className="mt-1 text-sm text-muted-foreground">Sign in to SIMATS Recruitment</p>
            </div>

            <div className="mt-7">
              {mode === "otp-email" ? (
                <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@simats.ac.in"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  {errorBanner}
                  <Button type="submit" size="lg" disabled={isSubmitting}>
                    {isSubmitting ? "Sending…" : "Send login code"}
                  </Button>

                  {/* Divider -- aria-hidden so "OR" isn't read out as content
                      between two controls that are already distinct. */}
                  <div aria-hidden="true" className="flex items-center gap-3 py-0.5">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-semibold tracking-wider text-muted-foreground">OR</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <button
                    type="button"
                    onClick={() => switchMode("password")}
                    className="rounded-lg border border-border py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Sign in with a password instead
                  </button>
                </form>
              ) : null}

              {mode === "otp-code" ? (
                <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                    Enter the 6-digit code sent to <span className="font-semibold text-foreground">{email}</span>.
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
                      className="text-center text-lg font-semibold tracking-[0.4em] tabular-nums"
                    />
                  </div>
                  {info ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {info}
                    </p>
                  ) : null}
                  {errorBanner}
                  <Button type="submit" size="lg" disabled={isSubmitting || code.length !== 6}>
                    {isSubmitting ? "Verifying…" : "Verify & sign in"}
                  </Button>
                  <div className="flex items-center justify-between text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => switchMode("otp-email")}
                      className="rounded text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      Use a different email
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void sendCode()}
                      className="rounded text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
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
                      placeholder="you@simats.ac.in"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">Password</Label>
                    <PasswordInput
                      id="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {errorBanner}
                  <Button type="submit" size="lg" disabled={isSubmitting}>
                    {isSubmitting ? "Signing in…" : "Sign in"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => switchMode("otp-email")}
                    className="rounded text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Sign in with a code instead
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <footer className="mt-7 flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium text-foreground/70">© SIMATS Recruitment</p>
            <p className="text-xs text-muted-foreground">Secure access • Authorized users only</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
