import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { createCandidate } from "@/api/candidates";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { combine, email as emailValidator, required, useFieldValidation } from "@/hooks/useFieldValidation";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
const SOURCE_OPTIONS = ["Reference", "Mail", "Other"] as const;

export function CandidateCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const fullName = useFieldValidation("", required("Full name is required"));
  const email = useFieldValidation("", combine(required("Email is required"), emailValidator()));
  const [phoneNumber, setPhoneNumber] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createCandidate({
        full_name: fullName.value,
        email: email.value,
        phone_number: phoneNumber || null,
        source: source || null,
      }),
    onSuccess: (result) => navigate(`/candidates/${result.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  if (!user || !CAN_CREATE_ROLES.includes(user.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, or Super Admin can add a new candidate.
      </p>
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const fullNameValid = fullName.validate();
    const emailValid = email.validate();
    if (!fullNameValid || !emailValid) return;
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">New candidate</h1>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
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
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email.value}
            onChange={(e) => email.onChange(e.target.value)}
            onBlur={email.onBlur}
            aria-invalid={Boolean(email.error)}
          />
          {email.error ? <p className="text-xs text-destructive">{email.error}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone_number">Phone number (optional)</Label>
          <Input id="phone_number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Source (optional)</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger>
              <SelectValue placeholder="How did they hear about this role?" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Create candidate"}
        </Button>
      </form>
    </div>
  );
}
