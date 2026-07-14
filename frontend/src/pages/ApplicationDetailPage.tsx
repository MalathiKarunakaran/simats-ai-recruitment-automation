import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getApplication, transitionApplicationStatus } from "@/api/applications";
import { getCandidate } from "@/api/candidates";
import { ApiError } from "@/api/client";
import { listInterviews } from "@/api/interviews";
import { listOffers } from "@/api/offers";
import {
  APPLICATION_STATUS_ORDER,
  APPLICATION_TERMINAL_STATUSES,
  type ApplicationStatus,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/applications/StatusBadge";
import { StatusBadge as InterviewStatusBadge } from "@/components/interviews/StatusBadge";
import { JoiningCard } from "@/components/joining/JoiningCard";
import { StatusBadge as OfferStatusBadge } from "@/components/offers/StatusBadge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const WRITE_ROLES = ["RECRUITMENT_OFFICER", "HR_ADMIN", "SUPER_ADMIN"];
const CAN_VIEW_OFFERS_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT"];
const CAN_CREATE_OFFER_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];
const CAN_VIEW_JOINING_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN"];
const ALL_STATUSES: ApplicationStatus[] = [...APPLICATION_STATUS_ORDER, "REJECTED"];

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { getLabel } = useJobPostingLookup();

  const [error, setError] = useState<string | null>(null);
  const [advanceTo, setAdvanceTo] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forceStatus, setForceStatus] = useState("");
  const [forceReason, setForceReason] = useState("");

  const { data: application, isLoading } = useQuery({
    queryKey: ["application", id],
    queryFn: () => getApplication(id!),
    enabled: Boolean(id),
  });

  const { data: candidate } = useQuery({
    queryKey: ["candidate", application?.candidate_id],
    queryFn: () => getCandidate(application!.candidate_id),
    enabled: Boolean(application),
  });

  const { data: applicationInterviews } = useQuery({
    queryKey: ["interviews", { applicationId: id }],
    queryFn: () => listInterviews({ applicationId: id }),
    enabled: Boolean(id),
  });

  const canViewOffers = Boolean(user && CAN_VIEW_OFFERS_ROLES.includes(user.role));
  const { data: applicationOffers } = useQuery({
    queryKey: ["offers", { applicationId: id }],
    queryFn: () => listOffers({ applicationId: id }),
    enabled: Boolean(id) && canViewOffers,
  });

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["application", id] });
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
  }

  const advanceMutation = useMutation({
    mutationFn: () => transitionApplicationStatus(id!, { status: advanceTo as ApplicationStatus }),
    onSuccess: () => {
      setError(null);
      setAdvanceTo("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Status update failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => transitionApplicationStatus(id!, { status: "REJECTED", reason: rejectReason }),
    onSuccess: () => {
      setError(null);
      setRejectDialogOpen(false);
      setRejectReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Reject failed"),
  });

  const forceMutation = useMutation({
    mutationFn: () =>
      transitionApplicationStatus(id!, {
        status: forceStatus as ApplicationStatus,
        reason: forceReason || null,
        force: true,
      }),
    onSuccess: () => {
      setError(null);
      setForceDialogOpen(false);
      setForceStatus("");
      setForceReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Force correction failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!application || !user) {
    return <Navigate to="/applications" replace />;
  }

  const isTerminal = APPLICATION_TERMINAL_STATUSES.has(application.status);
  const currentIndex = APPLICATION_STATUS_ORDER.indexOf(application.status);
  const forwardStatuses = currentIndex >= 0 ? APPLICATION_STATUS_ORDER.slice(currentIndex + 1) : [];

  const canWrite = WRITE_ROLES.includes(user.role);
  const canAdvance = canWrite && !isTerminal && forwardStatuses.length > 0;
  const canReject = canWrite && !isTerminal;
  const canForce = user.role === "SUPER_ADMIN";

  const joiningPendingIndex = APPLICATION_STATUS_ORDER.indexOf("JOINING_PENDING");
  const canViewJoining =
    CAN_VIEW_JOINING_ROLES.includes(user.role) && currentIndex >= joiningPendingIndex;

  const label = getLabel(application.job_posting_id);
  const isBusy = advanceMutation.isPending || rejectMutation.isPending || forceMutation.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{label?.positionTitle ?? "Application"}</h1>
          <div className="mt-1">
            <StatusBadge status={application.status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/applications">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {candidate ? (
            <Link to={`/candidates/${candidate.id}`} className="font-medium hover:underline">
              {candidate.full_name}
            </Link>
          ) : (
            "—"
          )}
          <div className="text-muted-foreground">{candidate?.email}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Applied</div>
            <div>{new Date(application.applied_at).toLocaleDateString()}</div>
          </div>
          {application.status === "REJECTED" && application.rejection_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Rejection reason</div>
              <div>{application.rejection_reason}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interviews</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!applicationInterviews || applicationInterviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews scheduled for this application yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applicationInterviews.map((interview) => (
                <li key={interview.id} className="flex items-center justify-between text-sm">
                  <Link to={`/interviews/${interview.id}`} className="hover:underline">
                    {interview.interview_type.replace(/_/g, " ")} · {new Date(interview.scheduled_at).toLocaleString()}
                  </Link>
                  <InterviewStatusBadge status={interview.status} />
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <Button variant="outline" size="sm" className="w-fit" asChild>
              <Link to={`/interviews/new?application_id=${application.id}`}>Schedule interview</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {canViewOffers ? (
        <Card>
          <CardHeader>
            <CardTitle>Offer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!applicationOffers || applicationOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offer made for this application yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {applicationOffers.map((offer) => (
                  <li key={offer.id} className="flex items-center justify-between text-sm">
                    <Link to={`/offers/${offer.id}`} className="hover:underline">
                      {offer.salary_currency} {offer.salary_amount}
                    </Link>
                    <OfferStatusBadge status={offer.status} />
                  </li>
                ))}
              </ul>
            )}
            {user && CAN_CREATE_OFFER_ROLES.includes(user.role) ? (
              <Button variant="outline" size="sm" className="w-fit" asChild>
                <Link to={`/offers/new?application_id=${application.id}`}>Make an offer</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canViewJoining ? <JoiningCard application={application} /> : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-2">
        {canAdvance ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Advance to</Label>
              <Select value={advanceTo} onValueChange={setAdvanceTo}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select next status" />
                </SelectTrigger>
                <SelectContent>
                  {forwardStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={isBusy || !advanceTo} onClick={() => advanceMutation.mutate()}>
              {advanceMutation.isPending ? "Updating…" : "Update status"}
            </Button>
          </div>
        ) : null}

        {canReject ? (
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={isBusy}>
                Reject
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject application</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reject_reason">Reason</Label>
                <Textarea
                  id="reject_reason"
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!rejectReason.trim() || rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate()}
                >
                  {rejectMutation.isPending ? "Rejecting…" : "Confirm reject"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {canForce ? (
          <Dialog open={forceDialogOpen} onOpenChange={setForceDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isBusy}>
                Force correct status
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Force correct status</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>New status</Label>
                  <Select value={forceStatus} onValueChange={setForceStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="force_reason">Reason (optional)</Label>
                  <Textarea
                    id="force_reason"
                    value={forceReason}
                    onChange={(e) => setForceReason(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button disabled={!forceStatus || forceMutation.isPending} onClick={() => forceMutation.mutate()}>
                  {forceMutation.isPending ? "Applying…" : "Apply correction"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
