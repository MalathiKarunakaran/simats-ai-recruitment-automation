import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { deleteSanctionedStrength } from "@/api/sanctionedStrength";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// Soft-delete confirm dialog (zany-snuggling-pie.md Phase D, item 3) --
// same Dialog/DialogHeader/DialogTitle/DialogFooter + destructive Button
// shape as ApplicationDetailPage's reject/withdraw dialogs. No reason-gate
// (this is a toggle, not a rejection), but the backend's 409 "N active
// employees, cannot delete" is surfaced inline in the dialog body, not as a
// page-level banner or generic toast (this codebase has no toast system).

export interface DeleteSanctionedStrengthDialogProps {
  sanctionedStrengthId: string;
  designationName: string;
  departmentId: string;
}

export function DeleteSanctionedStrengthDialog({
  sanctionedStrengthId,
  designationName,
  departmentId,
}: DeleteSanctionedStrengthDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteSanctionedStrength(sanctionedStrengthId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to delete sanctioned strength"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm" aria-label={`Delete sanctioned strength for ${designationName}`}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete sanctioned strength</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Remove the sanctioned strength record for <span className="font-medium text-foreground">{designationName}</span>?
          This is a soft delete -- it can be re-added later, but the current ceiling is removed immediately.
        </p>
        {error ? (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
