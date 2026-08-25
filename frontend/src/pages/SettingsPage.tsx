import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "@/api/client";
import { getOwnProfile, updateOwnProfile } from "@/api/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { minLength, required, useFieldValidation } from "@/hooks/useFieldValidation";
import { useTheme } from "@/theme/ThemeContext";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();

  const { data: profile, isLoading } = useQuery({ queryKey: ["users", "me"], queryFn: getOwnProfile });

  const fullName = useFieldValidation("", required("Full name is required"));
  const [phoneNumber, setPhoneNumber] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    fullName.onChange(profile.full_name);
    setPhoneNumber(profile.phone_number ?? "");
    // Only sync from the server once profile data first arrives -- don't
    // clobber in-progress edits on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const passwordValid = !newPassword || newPassword.length >= 8;

  const mutation = useMutation({
    mutationFn: () =>
      updateOwnProfile({
        full_name: fullName.value,
        phone_number: phoneNumber || null,
        ...(newPassword ? { password: newPassword } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setSuccess(true);
      setNewPassword("");
      void queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
    onError: (err) => {
      setSuccess(false);
      setError(err instanceof ApiError ? err.message : "Update failed");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(false);
    if (!fullName.validate() || !passwordValid) return;
    mutation.mutate();
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">{profile?.email}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                required
                value={fullName.value}
                onChange={(e) => fullName.onChange(e.target.value)}
                onBlur={fullName.onBlur}
                aria-invalid={Boolean(fullName.error)}
              />
              {fullName.error ? <p className="text-xs text-destructive">{fullName.error}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone_number">Phone number</Label>
              <Input id="phone_number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_password">New password (leave blank to keep current)</Label>
              <PasswordInput
                id="new_password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={!passwordValid}
              />
              {!passwordValid ? (
                <p className="text-xs text-destructive">{minLength(8)(newPassword)}</p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? <p className="text-sm text-brand-success">Saved.</p> : null}

            <Button type="submit" className="w-fit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm">
            <div className="font-medium">Theme</div>
            <div className="text-muted-foreground">Currently {theme === "dark" ? "dark" : "light"} mode</div>
          </div>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            Switch to {theme === "dark" ? "light" : "dark"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
