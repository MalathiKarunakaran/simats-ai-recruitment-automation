import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getApplication } from "@/api/applications";
import { getCandidate } from "@/api/candidates";
import { ApiError } from "@/api/client";
import { acceptOffer, declineOffer, getOffer, markOfferExpired, sendOffer, withdrawOffer } from "@/api/offers";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/offers/StatusBadge";
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
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

const WRITE_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

export function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { getLabel } = useJobPostingLookup();

  const [error, setError] = useState<string | null>(null);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const { data: offer, isLoading } = useQuery({
    queryKey: ["offer", id],
    queryFn: () => getOffer(id!),
    enabled: Boolean(id),
  });

  const { data: application } = useQuery({
    queryKey: ["application", offer?.application_id],
    queryFn: () => getApplication(offer!.application_id),
    enabled: Boolean(offer),
  });

  const { data: candidate } = useQuery({
    queryKey: ["candidate", application?.candidate_id],
    queryFn: () => getCandidate(application!.candidate_id),
    enabled: Boolean(application),
  });

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["offer", id] });
    void queryClient.invalidateQueries({ queryKey: ["offers"] });
  }

  function makeMutation(fn: (id: string) => Promise<unknown>) {
    return {
      mutationFn: () => fn(id!),
      onSuccess: () => {
        setError(null);
        afterAction();
      },
      onError: (err: unknown) => setError(err instanceof ApiError ? err.message : "Action failed"),
    };
  }

  const sendMutation = useMutation(makeMutation(sendOffer));
  const acceptMutation = useMutation(makeMutation(acceptOffer));
  const withdrawMutation = useMutation(makeMutation(withdrawOffer));
  const expireMutation = useMutation(makeMutation(markOfferExpired));
  const declineMutation = useMutation({
    mutationFn: () => declineOffer(id!, declineReason),
    onSuccess: () => {
      setError(null);
      setDeclineDialogOpen(false);
      setDeclineReason("");
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Decline failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!offer || !user) {
    return <Navigate to="/offers" replace />;
  }

  const canWrite = WRITE_ROLES.includes(user.role);
  const canSend = canWrite && offer.status === "DRAFT";
  const canRespond = canWrite && offer.status === "SENT";
  const positionLabel = application ? getLabel(application.job_posting_id)?.positionTitle : undefined;
  const isBusy =
    sendMutation.isPending || acceptMutation.isPending || withdrawMutation.isPending || expireMutation.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {offer.salary_currency} {offer.salary_amount} offer
          </h1>
          <div className="mt-1">
            <StatusBadge status={offer.status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/offers">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {candidate && application ? (
            <>
              <Link to={`/applications/${application.id}`} className="font-medium hover:underline">
                {candidate.full_name}
              </Link>
              <div className="text-muted-foreground">
                {positionLabel ?? "Unknown position"} · {candidate.email}
              </div>
            </>
          ) : (
            "—"
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offer details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Joining date</div>
            <div>{new Date(offer.joining_date).toLocaleDateString()}</div>
          </div>
          {offer.expires_at ? (
            <div>
              <div className="text-muted-foreground">Expires at</div>
              <div>{new Date(offer.expires_at).toLocaleDateString()}</div>
            </div>
          ) : null}
          {offer.terms ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Terms</div>
              <div>{offer.terms}</div>
            </div>
          ) : null}
          {offer.status === "DECLINED" && offer.decline_reason ? (
            <div className="col-span-2">
              <div className="text-muted-foreground">Decline reason</div>
              <div>{offer.decline_reason}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {canSend ? (
          <Button disabled={isBusy} onClick={() => sendMutation.mutate()}>
            {sendMutation.isPending ? "Sending…" : "Send"}
          </Button>
        ) : null}
        {canRespond ? (
          <>
            <Button disabled={isBusy} onClick={() => acceptMutation.mutate()}>
              {acceptMutation.isPending ? "Accepting…" : "Accept"}
            </Button>
            <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" disabled={isBusy}>
                  Decline
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Decline offer</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="decline_reason">Reason</Label>
                  <Textarea
                    id="decline_reason"
                    required
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="destructive"
                    disabled={!declineReason.trim() || declineMutation.isPending}
                    onClick={() => declineMutation.mutate()}
                  >
                    {declineMutation.isPending ? "Declining…" : "Confirm decline"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" disabled={isBusy} onClick={() => withdrawMutation.mutate()}>
              {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw"}
            </Button>
            <Button variant="outline" disabled={isBusy} onClick={() => expireMutation.mutate()}>
              {expireMutation.isPending ? "Marking…" : "Mark expired"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
