import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { listApplications } from "@/api/applications";
import { listCandidates } from "@/api/candidates";
import { ApiError } from "@/api/client";
import { createOffer } from "@/api/offers";
import type { ApplicationRead } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { ApplicationPicker } from "@/components/interviews/ApplicationPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_CREATE_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

export function OfferCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedApplicationId = searchParams.get("application_id");

  const { data: applications } = useQuery({ queryKey: ["applications", {}], queryFn: () => listApplications() });
  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { getLabel } = useJobPostingLookup();

  const preselected = preselectedApplicationId
    ? (applications?.find((a) => a.id === preselectedApplicationId) ?? null)
    : null;

  const [application, setApplication] = useState<ApplicationRead | null>(null);
  const selectedApplication = preselectedApplicationId ? preselected : application;

  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("INR");
  const [joiningDate, setJoiningDate] = useState("");
  const [terms, setTerms] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  function getCandidateLabel(candidateId: string) {
    const candidate = candidates?.find((c) => c.id === candidateId);
    return candidate ? { full_name: candidate.full_name, email: candidate.email } : undefined;
  }

  const mutation = useMutation({
    mutationFn: () =>
      createOffer({
        application_id: selectedApplication!.id,
        salary_amount: Number(salaryAmount),
        salary_currency: salaryCurrency,
        joining_date: joiningDate,
        terms: terms || null,
        expires_at: expiresAt || null,
      }),
    onSuccess: (result) => navigate(`/offers/${result.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  if (!user || !CAN_CREATE_ROLES.includes(user.role)) {
    return <p className="text-sm text-muted-foreground">Only HR Admin or Super Admin can make an offer.</p>;
  }

  const candidateLabel = selectedApplication ? getCandidateLabel(selectedApplication.candidate_id) : undefined;
  const positionLabel = selectedApplication ? getLabel(selectedApplication.job_posting_id)?.positionTitle : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Make an offer</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="flex max-w-lg flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label>Application</Label>
          {preselectedApplicationId ? (
            <p className="text-sm">
              <span className="font-medium">{candidateLabel?.full_name ?? "Unknown candidate"}</span>{" "}
              <span className="text-muted-foreground">for {positionLabel ?? "Unknown position"}</span>
            </p>
          ) : (
            <ApplicationPicker
              applications={applications ?? []}
              getCandidateLabel={getCandidateLabel}
              value={application}
              onChange={setApplication}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salary_amount">Salary amount</Label>
            <Input
              id="salary_amount"
              type="number"
              min={0}
              step="0.01"
              required
              value={salaryAmount}
              onChange={(e) => setSalaryAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salary_currency">Currency</Label>
            <Input
              id="salary_currency"
              required
              value={salaryCurrency}
              onChange={(e) => setSalaryCurrency(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="joining_date">Joining date</Label>
          <Input
            id="joining_date"
            type="date"
            required
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="terms">Terms (optional)</Label>
          <Textarea id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expires_at">Offer expires at (optional)</Label>
          <Input id="expires_at" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button
          type="submit"
          disabled={mutation.isPending || !selectedApplication || !salaryAmount || !joiningDate}
        >
          {mutation.isPending ? "Saving…" : "Create draft offer"}
        </Button>
      </form>
    </div>
  );
}
