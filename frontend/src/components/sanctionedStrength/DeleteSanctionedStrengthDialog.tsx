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
//
// **Bug found and fixed (2026-08-17, live report)**: this dialog's own
// built-in invalidation (`sanctioned-strength-breakdown`/
// `sanctioned-strength-register`) is exactly right for its original caller,
// SanctionedStrengthPage.tsx's legacy department-rollup `DesignationRow`,
// which renders from those two query keys. But Teaching/Non-Teaching's own
// *dedicated* views (Phases E/F, added after this dialog already existed)
// render from a different pair of query keys entirely
// (`teaching-strength-view`/`non-teaching-strength-view`,
// TeachingStrengthTable.tsx/NonTeachingStrengthTable.tsx) that this dialog
// never knew about -- so a delete from either of those tables succeeded
// server-side (confirmed live: real 204, real soft-delete) but the row kept
// showing until something unrelated happened to refetch, reading to a user
// as "the Delete button does nothing." Fixed with an optional `onDeleted`
// callback, called *in addition to* (not instead of) this dialog's own
// built-in invalidation -- the legacy rollup caller doesn't pass one and
// keeps working exactly as before; StrengthRowActions (TeachingStrengthTable.tsx)
// now passes its own already-existing `onSaved` prop through to this, the
// same view-scoped invalidation callback it already threads to
// SanctionedStrengthDrawer for the Edit path -- Delete was simply the one
// path that never received it.

export interface DeleteSanctionedStrengthDialogProps {
  sanctionedStrengthId: string;
  designationName: string;
  departmentId: string;
  /** Optional -- lets a caller with its own view-scoped query key (e.g.
   * StrengthRowActions' `teaching-strength-view`/`non-teaching-strength-view`)
   * refetch after a successful delete, on top of this dialog's own built-in
   * breakdown/register invalidation. The legacy rollup-table caller
   * (SanctionedStrengthPage.tsx's DesignationRow) omits this since its own
   * data already comes from the breakdown/register queries this dialog
   * already invalidates unconditionally. */
  onDeleted?: () => void;
}

export function DeleteSanctionedStrengthDialog({
  sanctionedStrengthId,
  designationName,
  departmentId,
  onDeleted,
}: DeleteSanctionedStrengthDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteSanctionedStrength(sanctionedStrengthId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-breakdown", departmentId] });
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-register"] });
      onDeleted?.();
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
