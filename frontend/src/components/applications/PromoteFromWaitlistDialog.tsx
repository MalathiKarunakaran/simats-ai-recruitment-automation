import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { transitionApplicationStatus } from "@/api/applications";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PromoteFromWaitlistDialogProps {
  applicationId: string;
  candidateName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted: () => void;
}

// WAITLISTED -> SELECTED. The backend requires the reason (it is logged
// with who promoted) and refuses with 409 while the vacancy has no open
// slot, i.e. until the selected candidate has been rejected or withdrawn.
export function PromoteFromWaitlistDialog({
  applicationId,
  candidateName,
  open,
  onOpenChange,
  onPromoted,
}: PromoteFromWaitlistDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => transitionApplicationStatus(applicationId, { status: "SELECTED", reason: reason.trim() }),
    onSuccess: () => {
      setReason("");
      setError(null);
      onOpenChange(false);
      onPromoted();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Promotion failed"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote {candidateName} to Selected</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promote_reason">Reason</Label>
          <Textarea
            id="promote_reason"
            placeholder="e.g. Selected candidate declined the offer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Promoting…" : "Confirm promotion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
