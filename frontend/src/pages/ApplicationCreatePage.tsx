import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { createApplication } from "@/api/applications";
import { ApiError } from "@/api/client";
import { listCandidates } from "@/api/candidates";
import { listJobPostings } from "@/api/jobPostings";
import type { CandidateRead } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { CandidatePicker } from "@/components/candidates/CandidatePicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const CAN_CREATE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];

export function ApplicationCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<CandidateRead | null>(null);
  const [jobPostingId, setJobPostingId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { data: jobPostings } = useQuery({ queryKey: ["job-postings"], queryFn: listJobPostings });
  const { getLabel } = useJobPostingLookup();

  const activePostings = (jobPostings ?? []).filter((jp) => jp.is_active);

  const mutation = useMutation({
    mutationFn: () => createApplication({ candidate_id: candidate!.id, job_posting_id: jobPostingId }),
    onSuccess: (result) => navigate(`/applications/${result.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  if (!user || !CAN_CREATE_ROLES.includes(user.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Recruitment Officer, HR Admin, or Super Admin can record a new application.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">New application</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="flex max-w-lg flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label>Candidate</Label>
          <CandidatePicker candidates={candidates ?? []} value={candidate} onChange={setCandidate} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Job posting</Label>
          <Select value={jobPostingId} onValueChange={setJobPostingId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an active job posting" />
            </SelectTrigger>
            <SelectContent>
              {activePostings.map((jp) => (
                <SelectItem key={jp.id} value={jp.id}>
                  {getLabel(jp.id)?.positionTitle ?? jp.public_apply_slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={mutation.isPending || !candidate || !jobPostingId}>
          {mutation.isPending ? "Saving…" : "Record application"}
        </Button>
      </form>
    </div>
  );
}
