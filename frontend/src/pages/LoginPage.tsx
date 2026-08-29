import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, ClipboardList, ShieldCheck } from "lucide-react";

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

// Split-screen login, refined 2026-08-29. UI ONLY: every handler, mode
// transition, auth call and error string is carried over verbatim --
// `requestOtp`/`loginWithOtp`/`login` are called with the same arguments in
// the same order, and the three `Mode` values and their transitions are
// unchanged. No route, session or security behaviour is touched.
//
// **Why this page pins literal colours instead of using theme tokens.**
// Everywhere else in the app we use --background/--card/--foreground, which
// flip under `.dark` (ThemeContext puts that class on <html> from
// localStorage or the OS preference, and it applies here too -- the toggle
// itself lives behind auth, but the class does not). The brief for this
// screen specifies an exact palette -- white card, #F4F7FC ground, #172033
// text -- so honouring it means the login screen must look the same for a
// visitor whose OS is set to dark. That is a deliberate, page-scoped
// exception: a pre-auth brand screen is the one place a fixed treatment is
// right. Do NOT copy this pattern into signed-in pages.
//
// Palette (from the brief): navy #0F172A, royal blue #2563EB, deep royal
// #1D4ED8 (button fill -- ~6.3:1 with white, where #2563EB is ~4.5:1 and
// only just clears AA), teal #0F9D8A, ground #F4F7FC, text #172033,
// secondary text #475569 (~7.5:1 on white -- the brief asks for secondary
// text that stays clearly readable, so this is not a pale grey).
//
// Two deliberate omissions worth recording, both because the brief made them
// conditional:
//
// 1. **No "Forgot password?" link.** app/api/v1/routers/auth.py's
//    `/password-reset-request` is an explicit Phase 1 stub that only
//    `print()`s the token to the server console (no email delivery -- that's
//    the Notification Agent's later phase), and there is no /forgot-password
//    route in App.tsx to land on. A link here would send a locked-out user
//    into a dead end. Add it when email delivery lands.
//
// 2. **Button/link wording is unchanged.** These exact strings are the
//    accessible names LoginPage.test.tsx queries by (getByRole("button",
//    { name: ... })), and they match this app's sentence-case convention.
//    The visual treatment changes; the words do not.
const HIGHLIGHTS = [
  { icon: ClipboardList, label: "Vacancy Management" },
  { icon: Briefcase, label: "Recruitment Tracking" },
  { icon: BarChart3, label: "Workforce Analytics" },
] as const;

/** Backdrop for the brand panel. Cut back to two thin arcs from the previous
 * seven elements (a 40px grid pattern, four circles and two diagonal lines) --
 * the brief asked for roughly a 70% reduction, keeping only subtle abstract
 * shapes. Inline SVG rather than an image asset so it inherits the panel's
 * own colour, costs no extra request, and can never load late or broken. */
function BackdropShapes() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.13]"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 400 600"
      fill="none"
    >
      <circle cx="344" cy="102" r="152" stroke="currentColor" strokeWidth="0.75" />
      <circle cx="56" cy="516" r="134" stroke="currentColor" strokeWidth="0.75" />
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

  // Shared field styling -- a defined border at rest (not a hairline), a
  // royal-blue border plus a soft ring on focus, and placeholder text dark
  // enough to read. Overrides Input's token-based defaults for the same
  // fixed-palette reason documented at the top of this file.
  const fieldClass =
    "h-11 rounded-lg border-[#CBD5E1] bg-white text-[15px] text-[#172033] shadow-none placeholder:text-[#8A97AB] hover:border-[#2563EB]/50 focus-visible:border-[#2563EB] focus-visible:ring-2 focus-visible:ring-[#2563EB]/25";

  // Flat deep royal blue rather than the shared variant's blue gradient, and
  // `bg-none` is required to switch that gradient off.
  const primaryButtonClass =
    "h-11 w-full rounded-lg bg-[#1D4ED8] bg-none text-[15px] font-semibold text-white shadow-[0_2px_10px_rgba(29,78,216,0.30)] transition-colors hover:bg-[#1E40AF] hover:brightness-100 focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2";

  // role="alert" so a screen reader announces a failed sign-in rather than
  // leaving the user to go hunting for the message.
  const errorBanner = error ? (
    <p
      role="alert"
      className="rounded-lg border border-[#FBBFBF] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B42318]"
    >
      {error}
    </p>
  ) : null;

  return (
    <div className="grid min-h-screen bg-[#F4F7FC] lg:grid-cols-[45fr_55fr]">
      {/* LEFT 45% -- brand panel. Hidden below `lg` so it never competes with
          the form for space on a tablet or phone; the card carries the mark
          on its own there. */}
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(158deg,#0F172A_0%,#152C5E_42%,#1E40AF_78%,#0F9D8A_150%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <BackdropShapes />
        {/* One soft highlight for depth -- an abstract shape, not a pattern. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.10)_0%,transparent_70%)]"
        />

        <div className="relative flex items-center gap-3">
          <img src={simatsSeal} alt="" className="h-11 w-11 shrink-0 rounded-full bg-white/95 p-[3px]" />
          <p className="font-display text-lg leading-tight font-semibold tracking-tight">SIMATS Recruitment</p>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-[2rem] leading-[1.2] font-bold tracking-tight xl:text-[2.25rem]">
            Hire the right people, faster.
          </h1>
          <p className="mt-3 text-[13px] font-medium tracking-wide text-white/70 uppercase">
            Recruitment • Workforce • Vacancy Management
          </p>

          {/* Compact rows -- a minimal icon and a label, replacing the earlier
              ringed check circles the brief called out as too heavy. */}
          <ul className="mt-8 flex flex-col gap-3">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <Icon className="h-[18px] w-[18px] shrink-0 text-[#5EEAD4]" aria-hidden="true" />
                <span className="text-[15px] font-medium text-white/90">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-[13px] font-medium text-white/65">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Authorized Recruitment Personnel
        </p>
      </aside>

      {/* RIGHT 55% -- the login card. */}
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          {/* 20px radius (the brief's 18-22px), a close contact shadow for
              weight plus a wide, low-opacity blue cast for the glow. */}
          <div className="rounded-[20px] border border-[#E4EAF5] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_20px_48px_-20px_rgba(37,99,235,0.35)] sm:p-8">
            <div className="flex flex-col items-center text-center">
              <img src={simatsSeal} alt="SIMATS" className="h-12 w-12 rounded-full ring-1 ring-[#E4EAF5]" />
              <h2 className="mt-3.5 font-display text-[22px] leading-tight font-bold tracking-tight text-[#172033]">
                Welcome back
              </h2>
              <p className="mt-1 text-sm text-[#475569]">Sign in to SIMATS Recruitment</p>
            </div>

            <div className="mt-6">
              {mode === "otp-email" ? (
                <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email" className="text-[13px] font-semibold text-[#172033]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@simats.ac.in"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  {errorBanner}
                  <Button type="submit" className={primaryButtonClass} isLoading={isSubmitting}>
                    {isSubmitting ? "Sending…" : "Send login code"}
                  </Button>

                  {/* aria-hidden so "OR" is not read out as content between two
                      controls that are already distinct. */}
                  <div aria-hidden="true" className="flex items-center gap-3 py-0.5">
                    <span className="h-px flex-1 bg-[#E4EAF5]" />
                    <span className="text-[11px] font-semibold tracking-[0.12em] text-[#8A97AB]">OR</span>
                    <span className="h-px flex-1 bg-[#E4EAF5]" />
                  </div>

                  <button
                    type="button"
                    onClick={() => switchMode("password")}
                    className="h-11 rounded-lg border border-[#CBD5E1] text-sm font-semibold text-[#1D4ED8] transition-colors hover:border-[#2563EB] hover:bg-[#F4F7FC] focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Sign in with a password instead
                  </button>
                </form>
              ) : null}

              {mode === "otp-code" ? (
                <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
                  <p className="text-sm text-[#475569]">
                    Enter the 6-digit code sent to <span className="font-semibold text-[#172033]">{email}</span>.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="otp_code" className="text-[13px] font-semibold text-[#172033]">
                      Login code
                    </Label>
                    <Input
                      id="otp_code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      className={`${fieldClass} text-center text-lg font-semibold tracking-[0.4em] tabular-nums`}
                    />
                  </div>
                  {info ? (
                    <p role="status" className="text-sm text-[#475569]">
                      {info}
                    </p>
                  ) : null}
                  {errorBanner}
                  <Button
                    type="submit"
                    className={primaryButtonClass}
                    isLoading={isSubmitting}
                    disabled={isSubmitting || code.length !== 6}
                  >
                    {isSubmitting ? "Verifying…" : "Verify & sign in"}
                  </Button>
                  <div className="flex items-center justify-between text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => switchMode("otp-email")}
                      className="rounded text-[#1D4ED8] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:outline-none"
                    >
                      Use a different email
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void sendCode()}
                      className="rounded text-[#1D4ED8] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:outline-none disabled:opacity-50"
                    >
                      Resend code
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === "password" ? (
                <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password_email" className="text-[13px] font-semibold text-[#172033]">
                      Email
                    </Label>
                    <Input
                      id="password_email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@simats.ac.in"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password" className="text-[13px] font-semibold text-[#172033]">
                      Password
                    </Label>
                    <PasswordInput
                      id="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  {errorBanner}
                  <Button type="submit" className={primaryButtonClass} isLoading={isSubmitting}>
                    {isSubmitting ? "Signing in…" : "Sign in"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => switchMode("otp-email")}
                    className="rounded text-sm font-semibold text-[#1D4ED8] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:outline-none"
                  >
                    Sign in with a code instead
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <p className="mt-5 text-center text-[13px] text-[#64748B]">© SIMATS Recruitment</p>
        </div>
      </main>
    </div>
  );
}
