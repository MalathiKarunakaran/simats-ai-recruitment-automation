import {  useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { combine, required, useFieldValidation } from "@/hooks/useFieldValidation";
import { PASSWORD_MIN_LENGTH, passwordMinLength } from "@/auth/passwordPolicy";

// Forced-password-change screen -- reached via ProtectedRoute's own
// mustChangePassword guard, either right after a Super Admin admin-reset
// login or mid-session (client.ts's 403 PASSWORD_CHANGE_REQUIRED handling).
// Deliberately goes through the self-service PATCH /users/me (via
// AuthContext.saveOwnProfile, which also re-establishes the session -- a
// password change ends every session server-side, audit M3), not the
// SUPER_ADMIN-only adminResetPassword -- this is the user changing their
// own password, which is also the one call the backend's
// PASSWORD_CHANGE_REQUIRED lockout still allows through.
export function SetNewPasswordPage() {
  const { saveOwnProfile, completePasswordChange } = useAuth();
  const navigate = useNavigate();

  const newPassword = useFieldValidation(
    "",
    combine(required("New password is required"), passwordMinLength()),
  );
  const confirmPassword = useFieldValidation("", required("Please confirm your new password"));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const newPasswordValid = newPassword.validate();
    const confirmPasswordValid = confirmPassword.validate();
    if (!newPasswordValid || !confirmPasswordValid) return;
    if (newPassword.value !== confirmPassword.value) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      if (!saveOwnProfile) throw new Error("Session unavailable");
      const updatedUser = await saveOwnProfile({ password: newPassword.value });
      completePasswordChange(updatedUser);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set a new password");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Set a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Your password was reset. Choose a new password before continuing.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_password">New password</Label>
              <PasswordInput
                id="new_password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={newPassword.value}
                onChange={(e) => newPassword.onChange(e.target.value)}
                onBlur={newPassword.onBlur}
                aria-invalid={Boolean(newPassword.error)}
              />
              {newPassword.error ? <p className="text-xs text-destructive">{newPassword.error}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm_password">Confirm new password</Label>
              <PasswordInput
                id="confirm_password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={confirmPassword.value}
                onChange={(e) => confirmPassword.onChange(e.target.value)}
                onBlur={confirmPassword.onBlur}
                aria-invalid={Boolean(confirmPassword.error)}
              />
              {confirmPassword.error ? <p className="text-xs text-destructive">{confirmPassword.error}</p> : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Set new password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
