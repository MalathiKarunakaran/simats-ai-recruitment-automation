import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getCandidate, withdrawCandidate } from "@/api/candidates";
import { listApplications } from "@/api/applications";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge as ApplicationStatusBadge } from "@/components/applications/StatusBadge";
import { StatusBadge as CandidateStatusBadge } from "@/components/candidates/StatusBadge";
import { ResumeUpload } from "@/components/candidates/ResumeUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";
import { CAN_MANAGE_CANDIDATES_ROLES } from "@/pages/CandidatesListPage";

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const reason = useFieldValidation("", required());

  const { data: candidate, isLoading } = useQuery({
    queryKey: ["candidate", id],
    queryFn: () => getCandidate(id!),
    enabled: Boolean(id),
  });

  const { data: applications } = useQuery({
    queryKey: ["applications", { candidateId: id }],
    queryFn: () => listApplications({ candidateId: id }),
    enabled: Boolean(id),
  });

  const { getLabel } = useJobPostingLookup();

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawCandidate(id!, { reason: reason.value }),
    onSuccess: () => {
      setError(null);
      setWithdrawDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["candidate", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Withdraw failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!candidate) {
    return <Navigate to="/candidates" replace />;
  }

  const canWithdraw = Boolean(user && CAN_MANAGE_CANDIDATES_ROLES.includes(user.role));

  function submitWithdraw() {
    if (!reason.validate()) return;
    withdrawMutation.mutate();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{candidate.full_name}</h1>
          <div className="mt-1">
            <CandidateStatusBadge status={candidate.is_withdrawn} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/candidates">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{candidate.email}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div>{candidate.phone_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Source</div>
            <div>{candidate.source ?? "—"}</div>
          </div>
          {candidate.source === "Reference" && candidate.reference_name ? (
            <div>
              <div className="text-muted-foreground">Reference name</div>
              <div>{candidate.reference_name}</div>
            </div>
          ) : null}
          <div className="col-span-2">
            <div className="mb-1 text-muted-foreground">Resume</div>
            <ResumeUpload candidate={candidate} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {!applications || applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications recorded for this candidate yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applications.map((application) => {
                const label = getLabel(application.job_posting_id);
                return (
                  <li key={application.id} className="flex items-center justify-between text-sm">
                    <Link to={`/applications/${application.id}`} className="hover:underline">
                      {label?.positionTitle ?? "Unknown position"}
                    </Link>
                    <ApplicationStatusBadge status={application.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {candidate.is_withdrawn ? (
        <Card>
          <CardHeader>
            <CardTitle>Withdrawal details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Withdrawn date</div>
              <div>{candidate.withdrawn_at ? new Date(candidate.withdrawn_at).toLocaleDateString() : "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">Reason</div>
              <div>{candidate.withdrawn_reason ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!candidate.is_withdrawn && canWithdraw ? (
        <div>
          <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">Withdraw</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Withdraw candidate</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="withdrawn_reason">Reason</Label>
                  <Textarea
                    id="withdrawn_reason"
                    required
                    value={reason.value}
                    onChange={(e) => reason.onChange(e.target.value)}
                    onBlur={reason.onBlur}
                  />
                  {reason.error ? <p className="text-sm text-destructive">{reason.error}</p> : null}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!reason.value.trim() || withdrawMutation.isPending}
                  onClick={submitWithdraw}
                >
                  {withdrawMutation.isPending ? "Withdrawing…" : "Confirm withdraw"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
