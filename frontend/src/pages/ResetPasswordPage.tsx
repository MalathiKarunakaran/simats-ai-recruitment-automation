import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import simatsSeal from "@/assets/simats-seal.png";
import { confirmPasswordReset } from "@/api/auth";
import { ApiError } from "@/api/client";
import { PASSWORD_MIN_LENGTH } from "@/auth/passwordPolicy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

// Landing page for the emailed reset link (2026-10-30), outside
// ProtectedRoute like /login. The link is /reset-password#token=..., and
// the token is read from the FRAGMENT, which browsers never send to a
// server, so it stays out of Caddy's and uvicorn's logs and out of any
// Referer header. It is also wiped from the address bar on first render.
// Same fixed palette as LoginPage, for the reason documented there.

function readToken(): string {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return match ? match[1] : "";
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(readToken);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await confirmPasswordReset(token, password);
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? "This link is invalid, already used or expired. Ask for a new one from the sign-in page."
          : err instanceof ApiError
            ? err.message
            : "Could not change the password",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const fieldClass =
    "h-11 rounded-lg border-[#CBD5E1] bg-white text-[15px] text-[#172033] shadow-none placeholder:text-[#8A97AB] hover:border-[#2563EB]/50 focus-visible:border-[#2563EB] focus-visible:ring-2 focus-visible:ring-[#2563EB]/25";
  const primaryButtonClass =
    "h-11 w-full rounded-lg bg-[#1D4ED8] bg-none text-[15px] font-semibold text-white shadow-[0_2px_10px_rgba(29,78,216,0.30)] transition-colors hover:bg-[#1E40AF] hover:brightness-100 focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2";
  const linkClass =
    "rounded text-sm font-semibold text-[#1D4ED8] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:outline-none";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F4F7FC] px-4 py-10">
      <div className="w-full max-w-[400px] rounded-[20px] border border-[#E4EAF5] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_20px_48px_-20px_rgba(37,99,235,0.35)] sm:p-8">
        <div className="flex flex-col items-center text-center">
          <img src={simatsSeal} alt="SIMATS" className="h-12 w-12 rounded-full ring-1 ring-[#E4EAF5]" />
          <h1 className="mt-3.5 font-display text-[22px] leading-tight font-bold tracking-tight text-[#172033]">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm text-[#475569]">SIMATS Recruitment</p>
        </div>

        {token ? (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_password" className="text-[13px] font-semibold text-[#172033]">
                New password
              </Label>
              <PasswordInput
                id="new_password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
              />
              <p className="text-xs text-[#475569]">At least {PASSWORD_MIN_LENGTH} characters.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm_password" className="text-[13px] font-semibold text-[#172033]">
                Confirm new password
              </Label>
              <PasswordInput
                id="confirm_password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={fieldClass}
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-[#FBBFBF] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B42318]"
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" className={primaryButtonClass} isLoading={isSubmitting}>
              {isSubmitting ? "Saving…" : "Set new password"}
            </Button>
            <p className="text-xs text-[#475569]">Changing your password signs you out on every device.</p>
          </form>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <p role="alert" className="text-sm text-[#475569]">
              This page needs the link from your reset email. Open the link from the email again, or ask for a
              new one.
            </p>
          </div>
        )}

        <div className="mt-5 text-center">
          <Link to="/login" className={linkClass}>
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
